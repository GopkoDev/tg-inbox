import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../app.js';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startJobs, type Jobs } from '../../../platform/jobs.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import {
  endBroadcastFixture,
  insertBroadcast,
  launchBroadcastFixture,
  type FixtureRecipient,
} from '../../../test/fixtures/broadcasts.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import {
  createBroadcastJobs,
  createBroadcastQueues,
  MEASURE_BLOCKED_SHARE_QUEUE,
  registerBroadcastJobs,
  SEND_LINK_DLQ,
  SEND_LINK_QUEUE,
} from './jobs.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface JobRow {
  id: string;
  state: string;
  data: Record<string, unknown>;
  singleton_key: string | null;
  start_after: Date;
  retry_count: number;
  retry_limit: number;
}

const jobsOf = async (db: Db, name: string, workspaceId: string) =>
  (
    await sql<JobRow>`
      select id, state, data, singleton_key, start_after, retry_count, retry_limit
      from pgboss.job
      where name = ${name} and data->>'workspace_id' = ${workspaceId}
      order by created_on`.execute(db)
  ).rows;

/**
 * The queues on the real pg-boss, with a stand-in link and measure: the policy (one active link
 * per workspace across instances, retries, the dead letter's restart) is what is under test.
 */
describe('broadcasts queues on pg-boss (stand-in link; ADR-0007)', () => {
  let database: TestDatabase;
  let db: Db;
  const bosses: Jobs[] = [];
  const jobs = createBroadcastJobs();
  /** What a link of a workspace does; unset = nothing. */
  const behaviour = new Map<string, () => Promise<void>>();
  const measured: string[] = [];
  const errors: { obj: Record<string, unknown>; msg: string }[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    // Two instances, each with its own workers: the chain must still run one link per workspace.
    for (let i = 0; i < 2; i += 1) {
      const boss = await startJobs(database.url);
      bosses.push(boss);
      await createBroadcastQueues(boss);
      await registerBroadcastJobs(
        boss,
        {
          sendLink: {
            async runSendLink(workspaceId) {
              await behaviour.get(workspaceId)?.();
              return { staleResolved: 0, claimed: 0, outcomes: {}, successor: null };
            },
          },
          measure: {
            async measureBlockedShare(workspaceId, broadcastId) {
              measured.push(`${workspaceId}:${broadcastId}`);
              return null;
            },
          },
          logger: {
            info() {},
            error(obj, msg) {
              errors.push({ obj: obj as Record<string, unknown>, msg });
            },
          },
          clock: systemClock,
        },
        { pollingIntervalSeconds: 0.5 },
      );
    }
    jobs.bind(bosses[0]!);
  }, 120_000);

  afterAll(async () => {
    for (const boss of bosses) await boss.stop({ graceful: false });
    await db?.destroy();
    await database?.stop();
  });

  beforeEach(() => {
    errors.length = 0;
  });

  const enqueue = (workspaceId: string, startAfter?: Date) =>
    db.transaction().execute((tx) => jobs.enqueueSendLink(tx, workspaceId, startAfter));

  it('a queued link runs and each successor carries the chain until a link queues none', async () => {
    const ws = newId();
    let runs = 0;
    behaviour.set(ws, async () => {
      runs += 1;
      if (runs < 3) await enqueue(ws);
    });

    await enqueue(ws);

    await vi.waitFor(() => expect(runs).toBe(3), { timeout: 20_000 });
    await vi.waitFor(
      async () =>
        expect((await jobsOf(db, SEND_LINK_QUEUE, ws)).map((j) => j.state)).toEqual([
          'completed',
          'completed',
          'completed',
        ]),
      { timeout: 5_000 },
    );
    await sleep(1_500);
    expect(runs).toBe(3);
    // Ids only on the queue.
    for (const j of await jobsOf(db, SEND_LINK_QUEUE, ws)) {
      expect(j.data).toEqual({ workspace_id: ws });
      expect(j.singleton_key).toBe(ws);
    }
  }, 40_000);

  it('at most one link per workspace is active across two workers, and two workspaces send at the same time', async () => {
    const a = newId();
    const b = newId();
    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    const runs = new Map<string, number>();
    let bothAtOnce = false;
    for (const ws of [a, b]) {
      behaviour.set(ws, async () => {
        active.set(ws, (active.get(ws) ?? 0) + 1);
        peak.set(ws, Math.max(peak.get(ws) ?? 0, active.get(ws)!));
        if ((active.get(a) ?? 0) > 0 && (active.get(b) ?? 0) > 0) bothAtOnce = true;
        await sleep(400);
        active.set(ws, active.get(ws)! - 1);
        runs.set(ws, (runs.get(ws) ?? 0) + 1);
        if (runs.get(ws)! < 4) await enqueue(ws);
      });
    }

    // Launch-like starts, doubled: the singleton key absorbs the extra link.
    await Promise.all([enqueue(a), enqueue(a), enqueue(b), enqueue(b)]);

    await vi.waitFor(
      () => {
        expect(runs.get(a)).toBe(4);
        expect(runs.get(b)).toBe(4);
      },
      { timeout: 25_000 },
    );
    expect(peak.get(a)).toBe(1);
    expect(peak.get(b)).toBe(1);
    expect(bothAtOnce).toBe(true);
  }, 40_000);

  it('a link that throws three more times lands in the dead letter, which logs the workspace id and queues a fresh link 60 s later', async () => {
    const ws = newId();
    let runs = 0;
    behaviour.set(ws, async () => {
      runs += 1;
      throw new Error('link failed for New prices from Monday.');
    });

    await enqueue(ws);

    await vi.waitFor(() => expect(errors.map((e) => e.obj.workspace_id)).toContain(ws), {
      timeout: 45_000,
      interval: 250,
    });
    const handledAt = Date.now();
    expect(runs).toBe(4);
    const line = errors.find((e) => e.obj.workspace_id === ws)!;
    expect(line.obj).toEqual({ alert: 'broadcasts.send.dead-letter', workspace_id: ws });
    expect(JSON.stringify(line)).not.toContain('New prices');

    const links = await jobsOf(db, SEND_LINK_QUEUE, ws);
    expect(links.map((j) => j.state)).toEqual(['failed', 'created']);
    expect(links[0]!.retry_count).toBe(3);
    expect(links[0]!.retry_limit).toBe(3);
    const gap = links[1]!.start_after.getTime() - handledAt;
    expect(gap).toBeGreaterThan(55_000);
    expect(gap).toBeLessThanOrEqual(60_500);
    expect(links[1]!.data).toEqual({ workspace_id: ws });
    expect((await jobsOf(db, SEND_LINK_DLQ, ws)).map((j) => j.state)).toEqual(['completed']);
    behaviour.delete(ws);
  }, 60_000);

  it('the measure job is queued once per broadcast, 48 h later, with ids only, and runs the measure', async () => {
    const ws = newId();
    const broadcastId = newId();
    const later = new Date(Date.now() + 48 * 3_600_000);

    // Two endings of one broadcast (a stop, then a late abort) queue one measure.
    await db.transaction().execute((tx) => jobs.enqueueBlockedShare(tx, ws, broadcastId, later));
    await db.transaction().execute((tx) => jobs.enqueueBlockedShare(tx, ws, broadcastId, later));

    const queued = await jobsOf(db, MEASURE_BLOCKED_SHARE_QUEUE, ws);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toEqual({ workspace_id: ws, broadcast_id: broadcastId });
    expect(queued[0]!.singleton_key).toBe(broadcastId);
    expect(queued[0]!.retry_limit).toBe(2);
    expect(Math.abs(queued[0]!.start_after.getTime() - later.getTime())).toBeLessThan(1_000);
    expect(measured).not.toContain(`${ws}:${broadcastId}`);

    // A measure that is due runs.
    const due = newId();
    await db.transaction().execute((tx) => jobs.enqueueBlockedShare(tx, ws, due, new Date()));
    await vi.waitFor(() => expect(measured).toContain(`${ws}:${due}`), { timeout: 10_000 });
  }, 30_000);

  it('a job rolled back with its transaction is never queued', async () => {
    const ws = newId();
    await expect(
      db.transaction().execute(async (tx) => {
        await jobs.enqueueSendLink(tx, ws);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await jobsOf(db, SEND_LINK_QUEUE, ws)).toEqual([]);
  });
});

/** The real chain through `buildApp()`: its workers, the send link, the fake Bot API. */
describe('broadcasts.send through buildApp (AC-11, AC-15)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;
  let boss: Jobs;
  const lines: string[] = [];
  const TEXT = 'New prices from Monday.';

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    app = await buildApp(
      { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot, LOG_LEVEL: 'info' },
      { logStream },
    );
    db = createDb(database.url);
    // A second process that only queues: the link it queues runs on the app's workers.
    boss = await startJobs(database.url);
  }, 120_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await app?.close();
    await db?.destroy();
    await fake?.stop();
    await database?.stop();
  });

  beforeEach(() => {
    fake.reset();
    lines.length = 0;
  });

  async function seed(n: number) {
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    const { bot, token } = await insertBot(db, { workspaceId });
    const contacts: { id: string; chatId: string }[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = await insertContact(db, {
        workspaceId,
        firstName: `Customer ${i}`,
        reachForBot: bot.telegramBotId,
      });
      await insertConversation(db, { workspaceId, contactId: id });
      const { telegram_user_id } = await db
        .selectFrom('contacts')
        .select('telegram_user_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      contacts.push({ id, chatId: String(telegram_user_id) });
    }
    contacts.sort((x, y) => (x.id < y.id ? -1 : 1));
    const launch = async (recipients: FixtureRecipient[]) => {
      const id = await insertBroadcast(db, {
        workspaceId,
        authorAccountId: owner.accountId,
        name: 'Spring prices',
        text: TEXT,
      });
      await launchBroadcastFixture(db, {
        broadcast: id,
        launchedByAccountId: owner.accountId,
        telegramBotId: bot.telegramBotId,
        recipients,
        launchedAt: new Date(Date.now() - 60_000),
      });
      return id;
    };
    return { workspaceId, owner, bot, token, contacts, launch };
  }

  const queueLink = (workspaceId: string) =>
    boss.send(SEND_LINK_QUEUE, { workspace_id: workspaceId }, { singletonKey: workspaceId });

  const statusOf = (workspaceId: string, id: string) =>
    db
      .selectFrom('broadcasts')
      .select(['status', 'end_reason', 'ended_at'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const statesOf = async (workspaceId: string, id: string) =>
    (
      await db
        .selectFrom('broadcast_recipients')
        .select(['contact_id', 'state'])
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', id)
        .orderBy('position')
        .execute()
    ).map((r) => r.state);

  const sentChats = (token: string) =>
    fake
      .calls(token)
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.params.chat_id));

  it('a queued link sends to the end: a rate limit pauses it, its successor continues, the broadcast ends sent and its measure is queued 48 h later', async () => {
    const s = await seed(3);
    fake.bot(s.token).script({ sendMessage: [sendAnswers.tooMany(1)] });
    const id = await s.launch(s.contacts.map((c) => ({ contactId: c.id })));

    await queueLink(s.workspaceId);

    await vi.waitFor(async () => expect((await statusOf(s.workspaceId, id)).status).toBe('sent'), {
      timeout: 25_000,
      interval: 250,
    });
    expect(await statesOf(s.workspaceId, id)).toEqual(['delivered', 'delivered', 'delivered']);
    // The rate-limited recipient went back to waiting and was sent once more; nobody twice.
    const sent = sentChats(s.token);
    expect(sent).toHaveLength(4);
    expect(new Set(sent.slice(1))).toEqual(new Set(s.contacts.map((c) => c.chatId)));
    // The link that met the 429 queued a successor; the chain then ended.
    await vi.waitFor(
      async () => {
        const links = await jobsOf(db, SEND_LINK_QUEUE, s.workspaceId);
        expect(links.length).toBeGreaterThanOrEqual(2);
        expect(links.every((j) => j.state === 'completed')).toBe(true);
      },
      { timeout: 5_000 },
    );
    const { ended_at } = await statusOf(s.workspaceId, id);
    const measure = await jobsOf(db, MEASURE_BLOCKED_SHARE_QUEUE, s.workspaceId);
    expect(measure).toHaveLength(1);
    expect(measure[0]!.data).toEqual({ workspace_id: s.workspaceId, broadcast_id: id });
    expect(measure[0]!.start_after.getTime() - ended_at!.getTime()).toBe(48 * 3_600_000);
    // No log line carries the text, a name or a chat id.
    const log = lines.join('\n');
    expect(log).toContain('broadcast.link');
    expect(log).not.toContain(TEXT);
    expect(log).not.toContain('Customer');
    for (const c of s.contacts) expect(log).not.toContain(c.chatId);
  }, 40_000);

  it('after a restart the queued link continues with the waiting recipients: the one in flight ends not confirmed, nobody with an outcome is sent again', async () => {
    const s = await seed(5);
    fake.bot(s.token).script({});
    const [done, inFlight, ...waiting] = s.contacts;
    const id = await s.launch([
      { contactId: done!.id, state: 'delivered' },
      { contactId: inFlight!.id, state: 'sending', claimedAt: new Date(Date.now() - 30_000) },
      ...waiting.map((c) => ({ contactId: c.id })),
    ]);

    // The link the stopped process had queued, picked up by this instance.
    await queueLink(s.workspaceId);

    await vi.waitFor(async () => expect((await statusOf(s.workspaceId, id)).status).toBe('sent'), {
      timeout: 20_000,
      interval: 250,
    });
    const states = await db
      .selectFrom('broadcast_recipients')
      .select(['contact_id', 'state'])
      .where('workspace_id', '=', s.workspaceId)
      .where('broadcast_id', '=', id)
      .execute();
    const stateOf = (contactId: string) => states.find((r) => r.contact_id === contactId)!.state;
    expect(stateOf(done!.id)).toBe('delivered');
    expect(stateOf(inFlight!.id)).toBe('not_confirmed');
    for (const c of waiting) expect(stateOf(c.id)).toBe('delivered');
    expect(sentChats(s.token).sort()).toEqual(waiting.map((c) => c.chatId).sort());
  }, 40_000);

  it('the measure job logs broadcast.blocked_share for the delivered recipients now blocked, with ids and counts only', async () => {
    const s = await seed(4);
    const id = await s.launch(s.contacts.map((c) => ({ contactId: c.id, state: 'delivered' })));
    await endBroadcastFixture(db, { broadcast: id, status: 'sent' });
    await db
      .updateTable('contact_bot_reach')
      .set({ blocked_at: new Date(), changed_at: new Date() })
      .where('workspace_id', '=', s.workspaceId)
      .where('contact_id', '=', s.contacts[2]!.id)
      .execute();

    await boss.send(
      MEASURE_BLOCKED_SHARE_QUEUE,
      { workspace_id: s.workspaceId, broadcast_id: id },
      { singletonKey: id },
    );

    await vi.waitFor(
      () => expect(lines.some((l) => l.includes('broadcast.blocked_share'))).toBe(true),
      { timeout: 10_000 },
    );
    const line = JSON.parse(lines.find((l) => l.includes('broadcast.blocked_share'))!) as Record<
      string,
      unknown
    >;
    expect(line).toMatchObject({
      msg: 'broadcast.blocked_share',
      workspace_id: s.workspaceId,
      broadcast_id: id,
      delivered_count: 4,
      blocked_since_count: 1,
      share: 0.25,
    });
    const raw = lines.find((l) => l.includes('broadcast.blocked_share'))!;
    expect(raw).not.toContain(TEXT);
    expect(raw).not.toContain('Spring prices');
    expect(raw).not.toContain('Customer');
    for (const c of s.contacts) expect(raw).not.toContain(c.chatId);
  }, 30_000);
});
