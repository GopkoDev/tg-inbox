import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../app.js';
import { buildDeps } from '../../../deps.js';
import { createDeliver } from '../app/deliver.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startJobs, type Jobs } from '../../../platform/jobs.js';
import { startFakeTelegram, sendAnswers, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertMessage,
  insertReply,
  insertReplyAttempt,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { DELIVER_REPLIES_DLQ, DELIVER_REPLIES_QUEUE } from './jobs.js';

describe('inbox.deliver-replies worker (pg-boss + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;
  let boss: Jobs;

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
  beforeEach(async () => {
    await fake.reset();
  });

  const ago = (ms: number) => new Date(Date.now() - ms);

  /** A workspace with a scripted bot, an active operator and one conversation. */
  async function seed(o: { botState?: 'connected' | 'needs_token'; activeAuthor?: boolean } = {}) {
    const ws = await insertWorkspace(db, `Acme ${newId()}`);
    const { token } = await insertBot(db, { workspaceId: ws, state: o.botState ?? 'connected' });
    fake.bot(token).script({});
    const account = await insertAccount(db, { displayName: 'Op' });
    if (o.activeAuthor !== false) await insertMembership(db, ws, { accountId: account.id });
    const session = await insertSession(db, account.id, { createdAt: ago(3_600_000) });
    const contact = await insertContact(db, { workspaceId: ws, firstName: 'Alice' });
    const conv = await insertConversation(db, { workspaceId: ws, contactId: contact });
    await insertMessage(db, { workspaceId: ws, conversationId: conv, telegramMessageId: 1n });
    return { ws, token, conv, accountId: account.id, cookies: { session: session.token } };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  /** A `sending` reply with its member-initiated attempt, as the send route leaves it. */
  async function pendingReply(s: Seed, body: string, positionAt = ago(1000)) {
    const id = await insertReply(db, {
      workspaceId: s.ws,
      conversationId: s.conv,
      authorAccountId: s.accountId,
      body,
      positionAt,
    });
    await insertReplyAttempt(db, {
      workspaceId: s.ws,
      conversationId: s.conv,
      replyId: id,
      initiatedByAccountId: s.accountId,
    });
    return id;
  }

  const enqueue = (s: Seed, queue = DELIVER_REPLIES_QUEUE) =>
    boss.send(queue, { workspace_id: s.ws, conversation_id: s.conv }, { singletonKey: s.conv });

  const reply = (id: string) =>
    db.selectFrom('replies').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const sendCalls = (token: string) => fake.calls(token).filter((c) => c.method === 'sendMessage');
  const settled = (id: string, timeout = 15_000) =>
    vi.waitFor(async () => expect((await reply(id)).state).not.toBe('sending'), {
      timeout,
      interval: 100,
    });

  it('delivers a reply sent through the API within the latency target (AC-06, AC-17)', async () => {
    const s = await seed();
    const started = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${s.ws}/inbox/conversations/${s.conv}/replies`,
      cookies: s.cookies,
      payload: {
        client_key: newId(),
        body: 'Hello!\nYour order is ready.',
        last_seen_reply_id: null,
      },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    await settled(id, 5_000);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await reply(id)).state).toBe('sent');
    expect(sendCalls(s.token).map((c) => c.params.text)).toEqual(['Hello!\nYour order is ready.']);
    const attempt = await db
      .selectFrom('reply_attempts')
      .select(['outcome', 'started_at', 'finished_at'])
      .where('reply_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(attempt.outcome).toBe('accepted');
    expect(attempt.started_at).not.toBeNull();
  });

  it('p95 of send to sent stays within 2 s with a healthy fake', async () => {
    const batch = await Promise.all(Array.from({ length: 10 }, () => seed()));
    const times: number[] = [];
    // One worker poll takes at most one job per worker (2 per 0.5 s per node), so replies are sent in
    // pairs here: the target is per-reply latency, not burst throughput.
    for (let i = 0; i < batch.length; i += 2) {
      await Promise.all(
        batch.slice(i, i + 2).map(async (s) => {
          const started = Date.now();
          const res = await app.inject({
            method: 'POST',
            url: `/api/workspaces/${s.ws}/inbox/conversations/${s.conv}/replies`,
            cookies: s.cookies,
            payload: { client_key: newId(), body: 'Hi', last_seen_reply_id: null },
          });
          await settled((res.json() as { id: string }).id, 5_000);
          times.push(Date.now() - started);
        }),
      );
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThanOrEqual(2_000);
  });

  it('429 keeps the order inside the conversation while another conversation delivers (AC-12)', async () => {
    const a = await seed();
    const b = await seed();
    fake
      .bot(a.token)
      .script({ sendMessage: [sendAnswers.tooMany(1), sendAnswers.ok(101), sendAnswers.ok(102)] });
    const a1 = await pendingReply(a, 'a-one', ago(3000));
    const a2 = await pendingReply(a, 'a-two', ago(2000));
    const b1 = await pendingReply(b, 'b-one');
    await enqueue(a);
    await enqueue(b);
    await settled(b1);
    expect((await reply(a1)).state).toBe('sending');
    expect((await reply(a2)).state).toBe('sending');
    await settled(a1);
    await settled(a2);
    expect(sendCalls(a.token).map((c) => c.params.text)).toEqual(['a-one', 'a-one', 'a-two']);
    const [r1, r2] = [await reply(a1), await reply(a2)];
    expect([r1.state, r2.state]).toEqual(['sent', 'sent']);
    expect(Number(r1.telegram_message_id)).toBeLessThan(Number(r2.telegram_message_id));
  });

  it('an answer that never comes back is not_confirmed after 10 s and never sent twice (AC-11)', async () => {
    const s = await seed();
    fake.bot(s.token).script({ sendMessage: [sendAnswers.hang(30_000)] });
    const id = await pendingReply(s, 'maybe');
    await enqueue(s);
    await settled(id, 25_000);
    expect(await reply(id)).toMatchObject({ state: 'not_confirmed' });
    await enqueue(s);
    await new Promise((r) => setTimeout(r, 2_000));
    expect(sendCalls(s.token)).toHaveLength(1);
  }, 40_000);

  it('a job killed after the attempt started resolves it not_confirmed and sends nothing (AC-11)', async () => {
    const s = await seed();
    const id = await insertReply(db, {
      workspaceId: s.ws,
      conversationId: s.conv,
      authorAccountId: s.accountId,
    });
    await insertReplyAttempt(db, {
      workspaceId: s.ws,
      conversationId: s.conv,
      replyId: id,
      initiatedByAccountId: s.accountId,
      startedAt: ago(30_000),
    });
    await enqueue(s);
    await settled(id);
    expect((await reply(id)).state).toBe('not_confirmed');
    const attempt = await db
      .selectFrom('reply_attempts')
      .select('outcome')
      .where('reply_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(attempt.outcome).toBe('unknown');
    expect(sendCalls(s.token)).toHaveLength(0);
  });

  it('a deactivated author ends not delivered with no call (AC-09)', async () => {
    const s = await seed({ activeAuthor: false });
    const id = await pendingReply(s, 'late');
    await enqueue(s);
    await settled(id);
    expect(await reply(id)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'author_access_removed',
    });
    expect(sendCalls(s.token)).toHaveLength(0);
    const attempt = await db
      .selectFrom('reply_attempts')
      .select('outcome')
      .where('reply_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(attempt.outcome).toBe('skipped');
  });

  it('a bot that needs a new token ends the reply not delivered (AC-13)', async () => {
    const s = await seed({ botState: 'needs_token' });
    const id = await pendingReply(s, 'nope');
    await enqueue(s);
    await settled(id);
    expect(await reply(id)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'bot_not_working',
    });
    expect(sendCalls(s.token)).toHaveLength(0);
  });

  it('a blocked customer ends not delivered (AC-10)', async () => {
    const s = await seed();
    fake.bot(s.token).script({ sendMessage: [sendAnswers.blocked()] });
    const id = await pendingReply(s, 'hi');
    await enqueue(s);
    await settled(id);
    expect(await reply(id)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'customer_blocked',
    });
  });

  it('Telegram still refusing after 5 minutes ends not delivered (AC-12)', async () => {
    const s = await seed();
    fake.bot(s.token).script({ sendMessage: [sendAnswers.serverError()] });
    const id = await pendingReply(s, 'old', ago(301_000));
    await enqueue(s);
    await settled(id);
    expect(await reply(id)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'telegram_not_accepted',
    });
  });

  it('the dead-letter handler resolves in-flight attempts and never-attempted replies', async () => {
    const s = await seed();
    const inFlight = await insertReply(db, {
      workspaceId: s.ws,
      conversationId: s.conv,
      authorAccountId: s.accountId,
      positionAt: ago(5000),
    });
    await insertReplyAttempt(db, {
      workspaceId: s.ws,
      conversationId: s.conv,
      replyId: inFlight,
      initiatedByAccountId: s.accountId,
      startedAt: ago(1000),
    });
    const waiting = await pendingReply(s, 'waiting', ago(4000));
    await enqueue(s, DELIVER_REPLIES_DLQ);
    await settled(inFlight);
    await settled(waiting);
    expect((await reply(inFlight)).state).toBe('not_confirmed');
    expect(await reply(waiting)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'delivery_interrupted',
    });
    expect(sendCalls(s.token)).toHaveLength(0);
  });

  it('a throw after the attempt started, then an immediate re-run, sends exactly once (ADR-0004)', async () => {
    const s = await seed();
    const id = await pendingReply(s, 'once');
    const deps = buildDeps({ ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot });
    try {
      let armed = true;
      const delivery = {
        ...deps.replyDelivery,
        async finishAttempt(input: Parameters<typeof deps.replyDelivery.finishAttempt>[0]) {
          if (armed) {
            armed = false;
            throw new Error('database went away');
          }
          return deps.replyDelivery.finishAttempt(input);
        },
      };
      const delayed: number[] = [];
      const deliver = createDeliver({
        delivery,
        workspaces: deps.workspaceAccess,
        bots: {
          canCarryReplies: deps.bots.inboxStatus.canCarryReplies,
          sendText: deps.bots.sendText,
        },
        enqueueDelayed: async (_w, _c, seconds) => {
          delayed.push(seconds);
        },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        clock: deps.clock,
      });
      const input = { workspaceId: s.ws, conversationId: s.conv };
      await expect(deliver.deliverConversation(input)).rejects.toThrow('database went away');
      await deliver.deliverConversation(input);
      expect(sendCalls(s.token)).toHaveLength(1);
      expect(delayed).toHaveLength(1);
      expect((await reply(id)).state).toBe('sending');
      await new Promise((r) => setTimeout(r, 10_500));
      await deliver.deliverConversation(input);
      expect((await reply(id)).state).toBe('not_confirmed');
      expect(sendCalls(s.token)).toHaveLength(1);
    } finally {
      await deps.destroy();
    }
  }, 30_000);

  it('no reply was delivered twice over the whole suite', async () => {
    const dupes = await sql<{ reply_id: string }>`
      select reply_id from reply_attempts where outcome = 'accepted'
      group by reply_id having count(*) > 1`.execute(db);
    expect(dupes.rows).toEqual([]);
  });
});
