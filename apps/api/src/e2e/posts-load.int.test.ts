import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Post } from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { newId } from '../platform/ids.js';
import { startJobs, type Jobs } from '../platform/jobs.js';
import { POST_SEND_QUEUE } from '../modules/posts/infra/jobs.js';
import { createDestinationRepo } from '../modules/posts/infra/destination-repo.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertContact } from '../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../test/fixtures/conversations.js';
import { signedDelivery, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, postIntegrity, truncateAll } from './helpers.js';

const SECOND = 1000;
const CAPTURE_SLACK_MS = 1 * SECOND;
const FIRST_POST_MS = 60 * SECOND;
// Spec §6 asks for 10 updates/s for 60 s; the CI run keeps the rate and shortens the span.
const GROUP_RATE_PER_SECOND = 10;
const GROUP_SECONDS = 10;
const PRIVATE_MESSAGES = 30;

const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Posts under load (spec §6, AC-17, test-plan NFR validation): capture of private messages stays
 * as fast while a destination group is busy and posts go out, a chat's 429 delays only that chat
 * and never touches the bot's send pause, posts still wait for that pause, and a first post per
 * chat goes out within a minute of its time. Real routes, pg-boss and the fake Bot API.
 */
describe('posts under load (postgres + pg-boss + fake Bot API)', { timeout: 240_000 }, () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  let boss: Jobs;
  let nextUpdate = 1;
  let nextMessage = 1;
  let nextChat = 1;
  let nextPerson = 800_000;
  const touched: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config);
    app = await buildApp(config);
    await app.ready();
    boss = await startJobs(database.url);
  }, 120_000);
  afterAll(async () => {
    await boss?.stop();
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(async () => {
    await truncateAll(deps.db);
    fake.reset();
  });

  async function workspace(sendPausedUntil?: Date) {
    const ws = await insertWorkspace(deps.db, 'Acme Flowers');
    touched.push(ws);
    const { bot, token, webhookSecret } = await insertBot(deps.db, {
      workspaceId: ws,
      lastCheckedAt: new Date(),
      ...(sendPausedUntil && { sendPausedUntil }),
    });
    fake.bot(token).script({});
    const account = await insertAccount(deps.db, { displayName: 'owner person' });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, { accountId: account.id, role: 'owner' });
    return {
      ws,
      token,
      botId: bot.id,
      telegramBotId: bot.telegramBotId,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: { accountId: account.id, cookies: { session: session.token } },
    };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  async function destination(w: W, kind: 'group' | 'channel' = 'channel') {
    const chatId = -1_002_000_000_000 - nextChat++;
    const dest = await createDestinationRepo(deps.db).insert(w.ws, {
      id: newId(),
      telegramBotId: w.telegramBotId,
      chatId: BigInt(chatId),
      kind,
      title: `Chat ${chatId}`,
      username: null,
      connectedByAccountId: w.owner.accountId,
      connectedAt: new Date(),
      membershipChangedAt: new Date(),
    });
    return { id: dest.id, chatId };
  }

  const call = (w: W, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/workspaces/${w.ws}/posts${url}`,
      cookies: w.owner.cookies,
      ...(method === 'POST' && { payload: payload ?? {} }),
    });
  const stateOf = async (w: W, id: string) => Post.parse((await call(w, 'GET', `/${id}`)).json());
  const sends = (w: W) => fake.calls(w.token).filter((c) => c.method === 'sendMessage');

  async function publishNow(w: W, destinationId: string, text: string) {
    const created = await call(w, 'POST', '', { text, destination_id: destinationId });
    expect(created.statusCode, created.body).toBe(201);
    const d = Post.parse(created.json());
    const res = await call(w, 'POST', `/${d.id}/publish`, { expected_version: d.version });
    expect(res.statusCode, res.body).toBe(200);
    return d.id;
  }

  async function seedDue(w: W, destinationId: string, scheduledFor: Date, text: string) {
    const id = newId();
    const acc = w.owner.accountId;
    await sql`insert into posts (id, workspace_id, destination_id, text, silent, state, version,
      author_account_id, last_changed_by_account_id, last_changed_at, created_at, scheduled_for,
      scheduled_by_account_id, schedule_kind, needs_attention)
      values (${id}, ${w.ws}, ${destinationId}, ${text}, false, 'scheduled', 1, ${acc}, ${acc},
      now(), now(), ${scheduledFor}, ${acc}, 'time', false)`.execute(deps.db);
    await boss.send(POST_SEND_QUEUE, {
      post_id: id,
      workspace_id: w.ws,
      moment: scheduledFor.toISOString(),
    });
    return id;
  }

  /** One private customer message; resolves with the webhook's answer time. */
  async function privateMessage(w: W): Promise<number> {
    const fromId = nextPerson++;
    const started = performance.now();
    const res = await signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: Math.floor(Date.now() / 1000),
        fromId,
        text: 'Do you deliver on Sunday?',
      }),
    );
    expect(res.statusCode).toBe(200);
    return performance.now() - started;
  }

  const groupUpdate = (w: W, chatId: number, kind: 'group' | 'supergroup' | 'channel') =>
    signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: Math.floor(Date.now() / 1000),
        chatId,
        fromId: 900_000 + (nextUpdate % 50),
        chatType: kind,
        text: 'Anyone here? Hello from the group',
      }),
    );

  const count = async (table: 'contacts' | 'conversations' | 'messages', ws: string) =>
    Number(
      (
        await sql<{
          n: string;
        }>`select count(*) as n from ${sql.table(table)} where workspace_id = ${ws}`.execute(
          deps.db,
        )
      ).rows[0]!.n,
    );

  it('private capture stays as fast while a busy destination group writes and posts go out (AC-17)', async () => {
    const w = await workspace();
    const group = await destination(w, 'group');
    const channel = await destination(w);

    // Baseline: private messages alone, spaced like the loaded run.
    const baseline: number[] = [];
    for (let i = 0; i < PRIVATE_MESSAGES; i++) {
      baseline.push(await privateMessage(w));
      await sleep(250);
    }
    expect(await count('contacts', w.ws)).toBe(PRIVATE_MESSAGES);

    // Loaded: the destination group writes 10 updates/s, posts go out, privates keep arriving.
    const postIds: string[] = [];
    const traffic = (async () => {
      let sent = 0;
      for (let s = 0; s < GROUP_SECONDS; s++) {
        const tick = Date.now();
        await Promise.all(
          Array.from({ length: GROUP_RATE_PER_SECOND }, async (_, i) => {
            const res = await groupUpdate(w, group.chatId, i % 2 ? 'group' : 'supergroup');
            expect(res.statusCode).toBe(200);
            sent++;
          }),
        );
        await sleep(Math.max(0, SECOND - (Date.now() - tick)));
      }
      return sent;
    })();
    const loaded: number[] = [];
    const privates = (async () => {
      for (let i = 0; i < PRIVATE_MESSAGES; i++) {
        loaded.push(await privateMessage(w));
        await sleep(250);
        if (i % 10 === 0) postIds.push(await publishNow(w, group.id, `Post ${i}`));
      }
    })();
    const [groupSent] = await Promise.all([traffic, privates]);
    expect(groupSent).toBe(GROUP_RATE_PER_SECOND * GROUP_SECONDS);
    postIds.push(await publishNow(w, channel.id, 'Channel post'));

    console.info(
      `[posts-load] capture p95 baseline ${p95(baseline).toFixed(0)} ms, loaded ${p95(loaded).toFixed(0)} ms`,
    );
    expect(p95(loaded)).toBeLessThanOrEqual(p95(baseline) + CAPTURE_SLACK_MS);

    // Nothing written in the destination was captured: only the private customers exist.
    expect(await count('contacts', w.ws)).toBe(PRIVATE_MESSAGES * 2);
    expect(await count('conversations', w.ws)).toBe(PRIVATE_MESSAGES * 2);
    expect(await count('messages', w.ws)).toBe(PRIVATE_MESSAGES * 2);
    const pings = await sql<{
      n: string;
    }>`select count(*) as n from pings where workspace_id = ${w.ws}`.execute(deps.db);
    expect(Number(pings.rows[0]!.n)).toBe(0);

    await vi.waitFor(
      async () => {
        for (const id of postIds) expect((await stateOf(w, id)).state).toBe('published');
      },
      { timeout: 60_000 },
    );
    expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
  }, 180_000);

  it('a post answered 429 delays only its chat and leaves the bot send pause alone (AC-17)', async () => {
    const w = await workspace();
    const limited = await destination(w);
    const free = await destination(w);
    fake.bot(w.token).script({ sendMessage: [sendAnswers.tooMany(4)] });

    const first = await publishNow(w, limited.id, 'Held by the chat limit');
    await vi.waitFor(
      async () => {
        const row = await deps.db
          .selectFrom('destinations')
          .select('paused_until')
          .where('id', '=', limited.id)
          .executeTakeFirstOrThrow();
        expect(row.paused_until).not.toBeNull();
      },
      { timeout: 20_000 },
    );
    const bot = await deps.db
      .selectFrom('bots')
      .select('send_paused_until')
      .where('id', '=', w.botId)
      .executeTakeFirstOrThrow();
    expect(bot.send_paused_until).toBeNull();

    // Another chat of the same bot is not held by it.
    const other = await publishNow(w, free.id, 'Other chat goes out');
    await vi.waitFor(async () => expect((await stateOf(w, other)).state).toBe('published'), {
      timeout: 20_000,
    });
    expect((await stateOf(w, first)).state).not.toBe('published');

    // The limited chat's post goes out after the limit, within its window.
    await vi.waitFor(async () => expect((await stateOf(w, first)).state).toBe('published'), {
      timeout: 40_000,
    });
    const after = await deps.db
      .selectFrom('bots')
      .select('send_paused_until')
      .where('id', '=', w.botId)
      .executeTakeFirstOrThrow();
    expect(after.send_paused_until).toBeNull();
    expect(await postIntegrity.twoSendsOfOnePost(deps.db, w.ws)).toEqual([]);
  }, 90_000);

  it('posts still wait for the bot send pause in every chat (AC-17)', async () => {
    const w = await workspace(new Date(Date.now() + 6 * SECOND));
    const a = await destination(w);
    const b = await destination(w);
    const ids = [await publishNow(w, a.id, 'Chat A'), await publishNow(w, b.id, 'Chat B')];
    await sleep(3 * SECOND);
    expect(sends(w)).toHaveLength(0);
    for (const id of ids) expect((await stateOf(w, id)).state).toBe('scheduled');

    await vi.waitFor(
      async () => {
        for (const id of ids) expect((await stateOf(w, id)).state).toBe('published');
      },
      { timeout: 40_000 },
    );
    expect(sends(w)).toHaveLength(2);
  }, 90_000);

  it('the first post of each chat is accepted within a minute of its time (AC-09, AC-17)', async () => {
    const w = await workspace();
    const chats = [await destination(w), await destination(w), await destination(w, 'group')];
    const moment = new Date(Date.now() + 1_000);
    const ids: string[] = [];
    for (const c of chats) ids.push(await seedDue(w, c.id, moment, `First for ${c.chatId}`));

    await vi.waitFor(
      async () => {
        for (const id of ids) expect((await stateOf(w, id)).state).toBe('published');
      },
      { timeout: 60_000 },
    );
    const rows = await sql<{
      lag: number;
    }>`select extract(epoch from (sending_started_at - scheduled_for)) * 1000 as lag
      from posts where workspace_id = ${w.ws}`.execute(deps.db);
    expect(rows.rows).toHaveLength(3);
    for (const r of rows.rows) expect(Number(r.lag)).toBeLessThanOrEqual(FIRST_POST_MS);
    expect(await postIntegrity.startedLate(deps.db, w.ws)).toEqual([]);
    expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
  }, 90_000);

  it('replies keep their speed at 2 per second while posts go out (AC-17)', async () => {
    const w = await workspace();
    const chats = [await destination(w), await destination(w), await destination(w, 'group')];
    const REPLIES = 12;
    const targets: string[] = [];
    for (let i = 0; i < REPLIES; i++) {
      const at = new Date(Date.now() - 60_000);
      const conv = await insertConversation(deps.db, {
        workspaceId: w.ws,
        contactId: await insertContact(deps.db, {
          workspaceId: w.ws,
          telegramUserId: BigInt(620_000 + i),
        }),
        waitingSince: at,
        waitingStartedBy: 'message',
        lastMessageReceivedAt: at,
        lastActivityAt: at,
      });
      await insertMessage(deps.db, {
        workspaceId: w.ws,
        conversationId: conv,
        telegramMessageId: 1n,
        receivedAt: at,
        sentAt: at,
      });
      targets.push(conv);
    }

    const postIds: string[] = [];
    for (const [i, c] of chats.entries()) postIds.push(await publishNow(w, c.id, `Post ${i}`));

    const timedReply = async (conversationId: string) => {
      const started = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: `/api/workspaces/${w.ws}/inbox/conversations/${conversationId}/replies`,
        cookies: w.owner.cookies,
        payload: { client_key: newId(), body: `Reply ${conversationId}`, last_seen_reply_id: null },
      });
      expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
      const replyId = (res.json() as { id: string }).id;
      for (;;) {
        const row = await deps.db
          .selectFrom('replies')
          .select('state')
          .where('id', '=', replyId)
          .executeTakeFirstOrThrow();
        if (row.state !== 'sending') {
          expect(row.state).toBe('sent');
          return performance.now() - started;
        }
        if (performance.now() - started > 15 * SECOND) throw new Error('a reply did not leave');
        await sleep(20);
      }
    };
    const latencies: number[] = [];
    const inFlight: Promise<void>[] = [];
    for (const conv of targets) {
      inFlight.push(timedReply(conv).then((ms) => void latencies.push(ms)));
      await sleep(500);
    }
    await Promise.all(inFlight);

    console.info(`[posts-load] reply p95 ${p95(latencies).toFixed(0)} ms`);
    expect(latencies).toHaveLength(REPLIES);
    expect(p95(latencies), `reply p95 ${Math.round(p95(latencies))} ms`).toBeLessThanOrEqual(
      2 * SECOND,
    );
    await vi.waitFor(
      async () => {
        for (const id of postIds) expect((await stateOf(w, id)).state).toBe('published');
      },
      { timeout: 60_000 },
    );
    expect(await integrityViolations(deps.db, [w.ws])).toEqual([]);
  }, 120_000);
});
