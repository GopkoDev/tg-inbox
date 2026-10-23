import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { fixedClock, type FixedClock } from '../platform/clock.js';
import { startJobs, type Jobs } from '../platform/jobs.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertContact } from '../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../test/fixtures/conversations.js';
import { insertTelegramLink } from '../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { newId } from '../platform/ids.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations } from './helpers.js';

const MINUTE = 60_000;
const MEMBERS = 50;
const REPLIES = 24;
const REPLY_EVERY_MS = 500; // 2 replies per second

/**
 * Reply delivery under ping load (spec §6, test-plan "NFR validation"): 50 linked away members are
 * due at once on one bot while replies are sent at 2 per second and the fake Bot API answers one
 * rate limit with a retry time. The CI-sized version of the scenario: one burst of 50, about 12 s.
 */
describe('reply delivery under ping load (postgres + pg-boss workers + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let clock: FixedClock;
  let deps: Deps;
  let app: FastifyInstance;
  let boss: Jobs;
  let ticker: NodeJS.Timeout;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    clock = fixedClock(new Date());
    // The clock follows real time so the pause and the chain's delayed jobs resolve while the test runs.
    ticker = setInterval(() => clock.advance(100), 100);
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config, { clock });
    app = await buildApp(config, { clock });
    await app.ready();
    boss = await startJobs(database.url);
    deps.bindNotificationJobs(boss);
  });
  afterAll(async () => {
    clearInterval(ticker);
    await boss?.stop({ graceful: false });
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });

  const p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;

  it('50 pings due at once, one rate limit: every ping goes out after the pause and reply send p95 stays within 2 s', async () => {
    const db = deps.db;
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const { bot, token } = await insertBot(db, { workspaceId: ws });
    // The very first send (a ping) is answered with a rate limit of 1 s; everything else is accepted.
    fake.bot(token).script({ sendMessage: [sendAnswers.tooMany(1)] });

    const operator = await insertAccount(db, { displayName: 'Oleh Operator' });
    const session = await insertSession(db, operator.id, {
      createdAt: new Date(clock.now().getTime() - 3_600_000),
    });
    await insertMembership(db, ws, { accountId: operator.id });
    const cookies = { session: session.token };

    // 50 linked members, away, and one unassigned customer waiting for 6 minutes: due for all 50.
    const since = new Date(clock.now().getTime() - 6 * MINUTE);
    const waiter = await insertConversation(db, {
      workspaceId: ws,
      contactId: await insertContact(db, { workspaceId: ws, telegramUserId: 600000n }),
      waitingSince: since,
      waitingStartedBy: 'message',
      lastMessageReceivedAt: since,
      lastActivityAt: since,
    });
    await insertMessage(db, {
      workspaceId: ws,
      conversationId: waiter,
      telegramMessageId: 1n,
      receivedAt: since,
      sentAt: since,
    });
    const chatIds = new Set<number>();
    for (let i = 0; i < MEMBERS; i++) {
      const { accountId } = await insertMembership(db, ws);
      const link = await insertTelegramLink(db, {
        workspaceId: ws,
        accountId,
        telegramBotId: bot.telegramBotId,
        telegramUserId: BigInt(700000 + i),
      });
      chatIds.add(Number(link.telegramUserId));
    }

    // Conversations the operator answers while the pings go out (recent, so not due themselves).
    const targets: string[] = [];
    for (let i = 0; i < REPLIES; i++) {
      const at = new Date(clock.now().getTime() - MINUTE);
      const conv = await insertConversation(db, {
        workspaceId: ws,
        contactId: await insertContact(db, { workspaceId: ws, telegramUserId: BigInt(610000 + i) }),
        waitingSince: at,
        waitingStartedBy: 'message',
        lastMessageReceivedAt: at,
        lastActivityAt: at,
      });
      await insertMessage(db, {
        workspaceId: ws,
        conversationId: conv,
        telegramMessageId: 1n,
        receivedAt: at,
        sentAt: at,
      });
      targets.push(conv);
    }

    // All 50 pings become due together: start the workspace's chain.
    expect(await deps.startPings(ws)).toBe(true);
    await vi.waitFor(
      () => expect(fake.calls(token).some((c) => c.method === 'sendMessage')).toBe(true),
      { timeout: 15_000, interval: 20 },
    );

    // Replies at 2 per second while the pings are sent; time each from request to `sent`.
    let sawPause = false;
    const latencies: number[] = [];
    const sentIn = async (conversationId: string) => {
      const started = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: `/api/workspaces/${ws}/inbox/conversations/${conversationId}/replies`,
        cookies,
        payload: {
          client_key: newId(),
          body: `Reply for ${conversationId}`,
          last_seen_reply_id: null,
        },
      });
      expect(res.statusCode).toBe(201);
      const replyId = res.json().id as string;
      for (;;) {
        const row = await db
          .selectFrom('replies')
          .select('state')
          .where('id', '=', replyId)
          .executeTakeFirstOrThrow();
        if (row.state !== 'sending') {
          expect(row.state).toBe('sent');
          return performance.now() - started;
        }
        if (performance.now() - started > 15_000) throw new Error('a reply did not leave');
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const watching = setInterval(() => {
      void db
        .selectFrom('bots')
        .select('send_paused_until')
        .where('workspace_id', '=', ws)
        .executeTakeFirst()
        .then((row) => {
          if (row?.send_paused_until && row.send_paused_until.getTime() > clock.now().getTime()) {
            sawPause = true;
          }
        });
    }, 25);
    const inFlight: Promise<void>[] = [];
    for (const conv of targets) {
      inFlight.push(sentIn(conv).then((ms) => void latencies.push(ms)));
      await new Promise((r) => setTimeout(r, REPLY_EVERY_MS));
    }
    await Promise.all(inFlight);

    // Every ping leaves, each member once, after the rate-limit pause.
    await vi.waitFor(
      async () => {
        const accepted = await db
          .selectFrom('pings')
          .select(db.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', ws)
          .where('outcome', '=', 'accepted')
          .executeTakeFirstOrThrow();
        expect(Number(accepted.n)).toBe(MEMBERS);
      },
      { timeout: 60_000, interval: 100 },
    );
    clearInterval(watching);

    expect(latencies).toHaveLength(REPLIES);
    expect(p95(latencies), `reply p95 ${Math.round(p95(latencies))} ms`).toBeLessThanOrEqual(2000);
    expect(sawPause, 'the 429 paused the bot for sending').toBe(true);
    const pinged = fake
      .calls(token)
      .filter((c) => c.method === 'sendMessage' && chatIds.has(Number(c.params.chat_id)));
    // 50 accepted pings plus the one that was answered with the rate limit and retried after the pause.
    expect(new Set(pinged.map((c) => c.params.chat_id)).size).toBe(MEMBERS);
    expect(pinged.length).toBeGreaterThanOrEqual(MEMBERS + 1);
    const repliesSent = fake
      .calls(token)
      .filter((c) => c.method === 'sendMessage' && String(c.params.text).startsWith('Reply for'));
    expect(repliesSent).toHaveLength(REPLIES);
    expect(await integrityViolations(db, [ws], clock.now())).toEqual([]);
  }, 120_000);
});
