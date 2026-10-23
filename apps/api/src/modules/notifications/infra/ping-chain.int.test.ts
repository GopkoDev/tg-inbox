import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../app.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startJobs, type Jobs } from '../../../platform/jobs.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertConnectLink, insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { signedDelivery, telegramUpdate } from '../../../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { SCHEDULE_PINGS_QUEUE, SEND_PINGS_QUEUE } from './jobs.js';

const MIN = 60_000;

/** The chain and its cron backstop on the real queue (system clock): who is started, kept and ended. */
describe('notifications.send-pings chain and notifications.schedule-pings cron (pg-boss)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;
  let boss: Jobs;
  let nextUser = 51_000_000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    app = await buildApp({ ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot });
    db = createDb(database.url);
    boss = await startJobs(database.url);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await app?.close();
    await db?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(() => {
    fake.reset();
  });

  async function seed(o: { linked?: boolean; waiting?: boolean } = {}) {
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const inserted = await insertBot(db, { workspaceId, state: 'connected' });
    fake.bot(inserted.token).script({});
    const { accountId } = await insertMembership(db, workspaceId);
    const telegramUserId = nextUser++;
    if (o.linked !== false) {
      await insertTelegramLink(db, {
        workspaceId,
        accountId,
        telegramBotId: inserted.bot.telegramBotId,
        telegramUserId,
      });
    }
    if (o.waiting !== false) {
      await insertConversation(db, {
        workspaceId,
        contactId: await insertContact(db, { workspaceId, telegramUserId: nextUser++ }),
        assigneeAccountId: accountId,
        waitingSince: new Date(Date.now() - 6 * MIN),
        waitingStartedBy: 'message',
      });
    }
    return { workspaceId, accountId, telegramUserId, bot: inserted };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  const chainJobs = async (workspaceId: string) =>
    (
      await sql<{ state: string; start_after: Date; created_on: Date }>`
        select state, start_after, created_on from pgboss.job
        where name = ${SEND_PINGS_QUEUE} and data->>'workspace_id' = ${workspaceId}
        order by created_on`.execute(db)
    ).rows;
  const pingSends = (s: Seed) => fake.calls(s.bot.token).filter((c) => c.method === 'sendMessage');
  const dropChain = (workspaceId: string) =>
    sql`delete from pgboss.job where name = ${SEND_PINGS_QUEUE} and data->>'workspace_id' = ${workspaceId}`.execute(
      db,
    );

  it('a sweep pings, then queues the next link 20 s ahead (the chain)', async () => {
    const s = await seed();
    await boss.send(
      SEND_PINGS_QUEUE,
      { workspace_id: s.workspaceId },
      { singletonKey: s.workspaceId },
    );
    await vi.waitFor(() => expect(pingSends(s)).toHaveLength(1), { timeout: 15_000 });
    await vi.waitFor(
      async () => {
        const waiting = (await chainJobs(s.workspaceId)).filter((j) => j.state === 'created');
        expect(waiting).toHaveLength(1);
        const gap = waiting[0]!.start_after.getTime() - Date.now();
        expect(gap).toBeGreaterThan(5_000);
        expect(gap).toBeLessThanOrEqual(20_500);
      },
      { timeout: 10_000 },
    );
  }, 30_000);

  it('the chain ends when the workspace has no live link', async () => {
    const s = await seed({ linked: false });
    await boss.send(
      SEND_PINGS_QUEUE,
      { workspace_id: s.workspaceId },
      { singletonKey: s.workspaceId },
    );
    await vi.waitFor(
      async () => expect((await chainJobs(s.workspaceId))[0]?.state).toBe('completed'),
      { timeout: 15_000 },
    );
    expect((await chainJobs(s.workspaceId)).filter((j) => j.state === 'created')).toEqual([]);
    expect(pingSends(s)).toEqual([]);
  }, 30_000);

  it('the cron restarts a broken chain of a workspace with a live link, and only that', async () => {
    const live = await seed({ waiting: false });
    const none = await seed({ linked: false, waiting: false });
    await dropChain(live.workspaceId);
    await boss.send(SCHEDULE_PINGS_QUEUE, {});
    await vi.waitFor(async () => expect(await chainJobs(live.workspaceId)).not.toHaveLength(0), {
      timeout: 15_000,
    });
    expect(await chainJobs(none.workspaceId)).toEqual([]);
  }, 30_000);

  it('the cron does not double a chain that is alive (the singleton key absorbs it)', async () => {
    const s = await seed({ waiting: false });
    // A link waiting 10 minutes ahead: the chain is alive and idle.
    await dropChain(s.workspaceId);
    await boss.send(
      SEND_PINGS_QUEUE,
      { workspace_id: s.workspaceId },
      { singletonKey: s.workspaceId, startAfter: new Date(Date.now() + 10 * MIN) },
    );
    await boss.send(SCHEDULE_PINGS_QUEUE, {});
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await chainJobs(s.workspaceId)).toHaveLength(1);
  }, 30_000);

  it('a connect-link start starts the chain at once, without waiting for the cron', async () => {
    const s = await seed({ linked: false, waiting: false });
    await dropChain(s.workspaceId);
    const issued = await insertConnectLink(db, {
      workspaceId: s.workspaceId,
      accountId: s.accountId,
      createdAt: new Date(Date.now() - 60_000),
    });
    const secret = s.bot.webhookSecret!;
    const res = await signedDelivery(
      app,
      { id: s.bot.bot.id, secret },
      telegramUpdate({
        updateId: 1,
        messageId: 1,
        date: Math.floor(Date.now() / 1000),
        fromId: Number(s.telegramUserId),
        text: `/start ${issued.startPayload}`,
      }),
    );
    expect(res.statusCode).toBe(200);
    const link = await db
      .selectFrom('telegram_links')
      .select('id')
      .where('workspace_id', '=', s.workspaceId)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    expect(link).toBeDefined();
    expect(await chainJobs(s.workspaceId)).not.toHaveLength(0);
  }, 30_000);
});
