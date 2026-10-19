import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeps, type Deps } from '../../../deps.js';
import { fixedClock, type FixedClock } from '../../../platform/clock.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation, insertReadMark } from '../../../test/fixtures/conversations.js';
import { insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createNotificationSignals } from '../infra/signals.js';
import { createPingRepo } from '../infra/ping-repo.js';
import { createPresenceRepo } from '../infra/presence-repo.js';
import { createTelegramLinkRepo } from '../infra/telegram-link-repo.js';
import type { SendMemberMessage, TelegramLinkRepo } from './ports.js';
import { createSendPings } from './send-pings.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const MIN = 60_000;
const ago = (m: number) => new Date(NOW.getTime() - m * MIN);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runSweep (Postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let clock: FixedClock;
  let nextUser = 31_000_000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    clock = fixedClock(NOW);
    deps = buildDeps({ ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot }, { clock });
  });
  afterAll(async () => {
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(() => {
    fake.reset();
    clock.set(NOW);
  });

  const db = () => deps.db;

  async function seed(o: { botState?: 'connected' | 'taken_over' } = {}) {
    const workspaceId = await insertWorkspace(db(), 'Acme Flowers');
    const { token, bot } = await insertBot(db(), { workspaceId, state: o.botState ?? 'connected' });
    fake.bot(token).script({});
    const { accountId } = await insertMembership(db(), workspaceId);
    const link = await insertTelegramLink(db(), {
      workspaceId,
      accountId,
      telegramBotId: bot.telegramBotId,
      telegramUserId: nextUser++,
    });
    const conversationId = await insertConversation(db(), {
      workspaceId,
      contactId: await insertContact(db(), { workspaceId, telegramUserId: nextUser++ }),
      assigneeAccountId: accountId,
      waitingSince: ago(6),
      waitingStartedBy: 'message',
    });
    return { workspaceId, token, accountId, linkId: link.id, conversationId };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  /** Test seams: wrap one port of the real use case. */
  function build(options: {
    links?: (real: TelegramLinkRepo) => TelegramLinkRepo;
    beforeMembershipLock?: () => Promise<void>;
    send?: SendMemberMessage;
  }) {
    const realLinks = createTelegramLinkRepo(db());
    return createSendPings({
      transaction: (fn) => db().transaction().execute(fn),
      membership: {
        lockActiveMembers: async (tx, w, ids) => {
          await options.beforeMembershipLock?.();
          return deps.workspaceAccess.lockActiveMembers(
            tx as Parameters<typeof deps.workspaceAccess.lockActiveMembers>[0],
            w,
            ids,
          );
        },
      },
      links: options.links ? options.links(realLinks) : realLinks,
      presence: createPresenceRepo(db()),
      pings: createPingRepo(db()),
      reads: deps.notificationReads,
      bots: deps.bots,
      workspaces: deps.workspaceAccess,
      send: options.send ?? deps.bots.sendMemberMessage,
      signals: createNotificationSignals(),
      clock,
      panelUrl: 'http://localhost:5173',
    });
  }

  const pingRows = (s: Seed) =>
    db().selectFrom('pings').selectAll().where('workspace_id', '=', s.workspaceId).execute();
  const itemRows = (s: Seed) =>
    db().selectFrom('ping_items').selectAll().where('workspace_id', '=', s.workspaceId).execute();
  const sends = (s: Seed) => fake.calls(s.token).filter((c) => c.method === 'sendMessage');
  const deactivate = (s: Seed) =>
    db()
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: NOW })
      .where('workspace_id', '=', s.workspaceId)
      .where('account_id', '=', s.accountId)
      .execute();

  it('pings an away assignee at 5 minutes: one ping row and ledger item, then never again (AC-07, AC-08)', async () => {
    const s = await seed();
    const result = await build({}).runSweep(s.workspaceId);
    expect(result.nextRunAt).toEqual(new Date(NOW.getTime() + 20_000));
    expect(sends(s)).toHaveLength(1);
    expect(sends(s)[0]!.params.text).toContain(
      'Acme Flowers: 1 customer is waiting for your reply (6 min)',
    );
    expect(sends(s)[0]!.params.text).toContain(`/w/${s.workspaceId}/inbox/${s.conversationId}`);
    expect(await pingRows(s)).toMatchObject([{ account_id: s.accountId, outcome: 'accepted' }]);
    expect(await itemRows(s)).toMatchObject([{ conversation_id: s.conversationId }]);
    clock.advance(30 * MIN);
    await build({}).runSweep(s.workspaceId);
    expect(sends(s)).toHaveLength(1);
  });

  it('a taken-over bot still sends pings for customers who were already waiting (AC-10)', async () => {
    const s = await seed({ botState: 'taken_over' });
    await build({}).runSweep(s.workspaceId);
    expect(sends(s)).toHaveLength(1);
  });

  it('a Telegram 429 deletes the ping, keeps the conversation due, and the pause is stored (AC-10)', async () => {
    const s = await seed();
    fake.bot(s.token).script({ sendMessage: [sendAnswers.tooMany(30)] });
    const result = await build({}).runSweep(s.workspaceId);
    expect(result.nextRunAt).toEqual(new Date(NOW.getTime() + 30_000));
    expect(await pingRows(s)).toEqual([]);
    expect(await itemRows(s)).toEqual([]);
    const bot = await db()
      .selectFrom('bots')
      .select('send_paused_until')
      .where('workspace_id', '=', s.workspaceId)
      .executeTakeFirstOrThrow();
    expect(bot.send_paused_until).toEqual(new Date(NOW.getTime() + 30_000));
    // Inside the pause nothing is sent; after it the same conversation goes out.
    clock.advance(10_000);
    expect((await build({}).runSweep(s.workspaceId)).nextRunAt).toEqual(
      new Date(NOW.getTime() + 30_000),
    );
    expect(sends(s)).toHaveLength(1);
    clock.advance(30_000);
    await build({}).runSweep(s.workspaceId);
    expect(sends(s)).toHaveLength(2);
    expect(await pingRows(s)).toHaveLength(1);
  });

  it('a blocked member: the ping counts, the link turns not reachable (AC-10)', async () => {
    const s = await seed();
    fake.bot(s.token).script({ sendMessage: [sendAnswers.blocked()] });
    await build({}).runSweep(s.workspaceId);
    expect(await pingRows(s)).toMatchObject([{ outcome: 'blocked' }]);
    const link = await db()
      .selectFrom('telegram_links')
      .select('blocked_at')
      .where('id', '=', s.linkId)
      .executeTakeFirstOrThrow();
    expect(link.blocked_at).toEqual(NOW);
  });

  describe('races', () => {
    it('a deactivation that commits before the send transaction leads to no ping', async () => {
      const s = await seed();
      await build({
        beforeMembershipLock: async () => {
          await deactivate(s);
        },
      }).runSweep(s.workspaceId);
      expect(await pingRows(s)).toEqual([]);
      expect(sends(s)).toEqual([]);
    });

    it('a deactivation that arrives during the send transaction waits for its commit; the ping is sent', async () => {
      const s = await seed();
      let deactivation: Promise<unknown> | undefined;
      let deactivated = false;
      const sweep = build({
        links: (real) => ({
          ...real,
          // Called inside the send transaction, after the membership share lock.
          async findLiveByAccount(w, a, options, tx) {
            const found = await real.findLiveByAccount(w, a, options, tx);
            if (options?.lock === 'share') {
              deactivation = deactivate(s).then(() => {
                deactivated = true;
              });
              await pause(400);
              expect(deactivated).toBe(false);
            }
            return found;
          },
        }),
      });
      await sweep.runSweep(s.workspaceId);
      await deactivation;
      expect(deactivated).toBe(true);
      expect(sends(s)).toHaveLength(1);
      expect(await pingRows(s)).toHaveLength(1);
    });

    it('a Disconnect waits for the send transaction (the link row is share-locked)', async () => {
      const s = await seed();
      let disconnectLocked = false;
      let disconnect: Promise<unknown> | undefined;
      const sweep = build({
        links: (real) => ({
          ...real,
          async findLiveByAccount(w, a, options, tx) {
            const found = await real.findLiveByAccount(w, a, options, tx);
            if (options?.lock === 'share') {
              disconnect = db()
                .transaction()
                .execute(async (other) => {
                  await real.findLiveByAccount(w, a, { lock: true }, other);
                  disconnectLocked = true;
                });
              await pause(400);
              expect(disconnectLocked).toBe(false);
            }
            return found;
          },
        }),
      });
      await sweep.runSweep(s.workspaceId);
      await disconnect;
      expect(disconnectLocked).toBe(true);
      expect(await pingRows(s)).toHaveLength(1);
    });

    it('a read that lands after the sweep read drops the conversation out', async () => {
      const s = await seed();
      await build({
        beforeMembershipLock: async () => {
          await insertReadMark(db(), {
            workspaceId: s.workspaceId,
            conversationId: s.conversationId,
            accountId: s.accountId,
            readThroughAt: ago(1),
          });
        },
      }).runSweep(s.workspaceId);
      expect(await pingRows(s)).toEqual([]);
      expect(sends(s)).toEqual([]);
    });

    it('a tab opened after the sweep read keeps the ping back', async () => {
      const s = await seed();
      await build({
        beforeMembershipLock: async () => {
          await createPresenceRepo(db()).open(s.workspaceId, {
            id: '0199a000-0000-7000-8000-0000000000e1',
            accountId: s.accountId,
            liveUntil: new Date(NOW.getTime() + 50_000),
            onScreen: true,
            at: NOW,
          });
        },
      }).runSweep(s.workspaceId);
      expect(sends(s)).toEqual([]);
    });

    it('two workers sweeping at once leave one ping and one ledger item per period (QG-1 f)', async () => {
      const s = await seed();
      await Promise.all([build({}).runSweep(s.workspaceId), build({}).runSweep(s.workspaceId)]);
      expect(await pingRows(s)).toHaveLength(1);
      expect(await itemRows(s)).toHaveLength(1);
      expect(sends(s)).toHaveLength(1);
    });
  });

  it("is tenant-scoped: another workspace's link, conversation and presence never take part", async () => {
    const a = await seed();
    const b = await seed();
    await build({}).runSweep(a.workspaceId);
    expect(sends(a)).toHaveLength(1);
    expect(sends(b)).toEqual([]);
    expect(await pingRows(b)).toEqual([]);
  });
});
