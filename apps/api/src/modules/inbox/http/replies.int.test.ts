import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorEnvelope, ThreadReply } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
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

const NOW = new Date('2026-10-18T10:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('inbox reply routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url), { clock: fixedClock(NOW) });
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  type Who = { accountId: string; cookies: { session: string } };
  const member = async (workspaceId: string, displayName = 'Test User'): Promise<Who> => {
    const account = await insertAccount(db, { displayName });
    const session = await insertSession(db, account.id, { createdAt: ago(3600) });
    await insertMembership(db, workspaceId, { accountId: account.id });
    return { accountId: account.id, cookies: { session: session.token } };
  };
  const base = (ws: string, conv: string) => `/api/workspaces/${ws}/inbox/conversations/${conv}`;
  const post = (who: Who | null, url: string, payload: object) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, payload });
  const body = (text = 'Hello!', extra: Record<string, unknown> = {}) => ({
    client_key: newId(),
    body: text,
    last_seen_reply_id: null,
    ...extra,
  });

  /** A workspace with a bot, an operator, a teammate and a conversation holding one message. */
  const seed = async (botState: 'connected' | 'taken_over' | 'needs_token' = 'connected') => {
    const ws = await insertWorkspace(db, `Acme ${newId()}`);
    await insertBot(db, { workspaceId: ws, state: botState });
    const me = await member(ws);
    const mate = await member(ws, 'Olga Owner');
    const contact = await insertContact(db, { workspaceId: ws, firstName: 'Alice' });
    const conv = await insertConversation(db, { workspaceId: ws, contactId: contact });
    await insertMessage(db, { workspaceId: ws, conversationId: conv, telegramMessageId: 1n });
    return { ws, me, mate, conv, url: base(ws, conv) };
  };

  const counts = async (ws: string) => {
    const one = async (table: 'replies' | 'reply_attempts') =>
      Number(
        (
          await db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll().as('n'))
            .where('workspace_id', '=', ws)
            .executeTakeFirstOrThrow()
        ).n,
      );
    const jobs = await sql<{ n: string }>`
      select count(*) as n from pgboss.job
      where name = 'inbox.deliver-replies' and data->>'workspace_id' = ${ws}`.execute(db);
    return {
      replies: await one('replies'),
      attempts: await one('reply_attempts'),
      jobs: Number(jobs.rows[0]?.n),
    };
  };

  describe('sendReply', () => {
    it('stores the reply, its attempt and the drain job together and answers 201 (AC-11)', async () => {
      const s = await seed();
      const payload = body('Hello!\nYour order is ready.');
      const res = await post(s.me, `${s.url}/replies`, payload);
      expect(res.statusCode).toBe(201);
      const reply = ThreadReply.parse(res.json());
      expect(reply).toMatchObject({
        state: 'sending',
        body: payload.body,
        client_key: payload.client_key,
        conversation_id: s.conv,
        workspace_id: s.ws,
        author: { account_id: s.me.accountId, display_name: 'Test User' },
        position_at: NOW.toISOString(),
      });
      expect(await counts(s.ws)).toEqual({ replies: 1, attempts: 1, jobs: 1 });
      const job = await sql<{ data: unknown; singleton_key: string }>`
        select data, singleton_key from pgboss.job
        where name = 'inbox.deliver-replies' and data->>'workspace_id' = ${s.ws}`.execute(db);
      expect(job.rows[0]).toMatchObject({
        data: { workspace_id: s.ws, conversation_id: s.conv },
        singleton_key: s.conv,
      });
      const attempt = await db
        .selectFrom('reply_attempts')
        .select(['kind', 'initiated_by_account_id', 'conversation_id'])
        .where('reply_id', '=', reply.id)
        .executeTakeFirstOrThrow();
      expect(attempt).toEqual({
        kind: 'send',
        initiated_by_account_id: s.me.accountId,
        conversation_id: s.conv,
      });
    });

    it('works for a taken-over bot too', async () => {
      const s = await seed('taken_over');
      expect((await post(s.me, `${s.url}/replies`, body())).statusCode).toBe(201);
    });

    it('a double submit of one client key returns one reply and queues one job (AC-11)', async () => {
      const s = await seed();
      const payload = body();
      const [a, b] = await Promise.all([
        post(s.me, `${s.url}/replies`, payload),
        post(s.me, `${s.url}/replies`, payload),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      expect(a.json().id).toBe(b.json().id);
      expect(await counts(s.ws)).toEqual({ replies: 1, attempts: 1, jobs: 1 });
    });

    it('a repeat after the reply was sent answers 200 with the sent reply and enqueues nothing', async () => {
      const s = await seed();
      const key = newId();
      await insertReply(db, {
        workspaceId: s.ws,
        conversationId: s.conv,
        authorAccountId: s.me.accountId,
        state: 'sent',
        clientKey: key,
        body: 'Done',
      });
      const res = await post(s.me, `${s.url}/replies`, body('Done', { client_key: key }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'sent', body: 'Done' });
      expect(await counts(s.ws)).toMatchObject({ replies: 1, attempts: 0, jobs: 0 });
    });

    it('two deliberate sends with the same text are both stored', async () => {
      const s = await seed();
      await post(s.me, `${s.url}/replies`, body('Same'));
      await post(s.me, `${s.url}/replies`, body('Same'));
      expect(await counts(s.ws)).toMatchObject({ replies: 2, attempts: 2 });
    });

    it.each([
      ['empty', '', 'Write a reply before sending', { field: 'body' }],
      ['blank', ' \n ', 'Write a reply before sending', { field: 'body' }],
      [
        'too long',
        'a'.repeat(4097),
        'Replies are limited to 4096 characters',
        { field: 'body', max_length: 4096 },
      ],
      [
        'too long in UTF-16 units',
        '😀'.repeat(2049),
        'Replies are limited to 4096 characters',
        { field: 'body', max_length: 4096 },
      ],
    ])('400 for a %s body and stores nothing (AC-07)', async (_n, text, message, details) => {
      const s = await seed();
      const res = await post(s.me, `${s.url}/replies`, body(text));
      expect(res.statusCode).toBe(400);
      expect(ErrorEnvelope.parse(res.json()).error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message,
        details,
      });
      expect(await counts(s.ws)).toEqual({ replies: 0, attempts: 0, jobs: 0 });
    });

    it('400 for a body that does not match the schema', async () => {
      const s = await seed();
      const res = await post(s.me, `${s.url}/replies`, { client_key: 'nope', body: 'x' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it.each(['needs_token', 'disconnected'] as const)(
      '409 BOT_CANNOT_REPLY for a %s bot, even when over the limit, and stores nothing (AC-13)',
      async (state) => {
        const s = await seed(state === 'disconnected' ? 'connected' : state);
        if (state === 'disconnected') {
          await db
            .updateTable('bots')
            .set({
              state: 'disconnected',
              token_encrypted: null,
              webhook_secret_hash: null,
              connected_at: null,
            })
            .where('workspace_id', '=', s.ws)
            .execute();
        }
        for (let i = 0; i < 30; i++) {
          const id = await insertReply(db, {
            workspaceId: s.ws,
            conversationId: s.conv,
            authorAccountId: s.me.accountId,
          });
          await insertReplyAttempt(db, {
            workspaceId: s.ws,
            conversationId: s.conv,
            replyId: id,
            initiatedByAccountId: s.me.accountId,
            createdAt: ago(5),
          });
        }
        const res = await post(s.me, `${s.url}/replies`, body());
        expect(res.statusCode).toBe(409);
        const error = ErrorEnvelope.parse(res.json()).error;
        expect(error.code).toBe('BOT_CANNOT_REPLY');
        expect(error.details).toMatchObject({
          bot: {
            workspace_id: s.ws,
            can_reply: false,
            state: state === 'disconnected' ? 'not_connected' : state,
          },
        });
        expect(await counts(s.ws)).toMatchObject({ replies: 30, attempts: 30, jobs: 0 });
      },
    );

    it('429 REPLY_LIMIT_REACHED at 30 sends in 60 s with Retry-After; retries and other workspaces do not count (AC-12b)', async () => {
      const s = await seed();
      const fill = async (kind: 'send' | 'retry', createdAt: Date, n: number) => {
        for (let i = 0; i < n; i++) {
          const id = await insertReply(db, {
            workspaceId: s.ws,
            conversationId: s.conv,
            authorAccountId: s.me.accountId,
          });
          await insertReplyAttempt(db, {
            workspaceId: s.ws,
            conversationId: s.conv,
            replyId: id,
            kind,
            initiatedByAccountId: kind === 'retry' ? null : s.me.accountId,
            createdAt,
          });
        }
      };
      await fill('send', ago(40), 1);
      await fill('send', ago(10), 28);
      await fill('retry', ago(5), 5);
      expect((await post(s.me, `${s.url}/replies`, body())).statusCode).toBe(201); // the 30th
      const res = await post(s.me, `${s.url}/replies`, body());
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('20');
      expect(ErrorEnvelope.parse(res.json()).error).toMatchObject({
        code: 'REPLY_LIMIT_REACHED',
        details: { limit: 30, window_seconds: 60, retry_at: ago(-20).toISOString() },
      });
      // the same account in another workspace is unaffected
      const other = await seed();
      await db
        .updateTable('memberships')
        .set({ account_id: s.me.accountId })
        .where('account_id', '=', other.me.accountId)
        .execute();
      expect((await post(s.me, `${other.url}/replies`, body())).statusCode).toBe(201);
    });

    it('409 TEAMMATE_REPLIED unless confirmed, and a retry of the same key with the flag sends (AC-16)', async () => {
      const s = await seed();
      const seen = await insertReply(db, {
        workspaceId: s.ws,
        conversationId: s.conv,
        authorAccountId: s.mate.accountId,
        state: 'sent',
        positionAt: ago(300),
        body: 'old',
      });
      const fresh = await insertReply(db, {
        workspaceId: s.ws,
        conversationId: s.conv,
        authorAccountId: s.mate.accountId,
        state: 'sent',
        positionAt: ago(30),
        body: 'new',
      });
      const payload = body('Mine', { last_seen_reply_id: seen });
      const res = await post(s.me, `${s.url}/replies`, payload);
      expect(res.statusCode).toBe(409);
      expect(ErrorEnvelope.parse(res.json()).error).toMatchObject({
        code: 'TEAMMATE_REPLIED',
        details: {
          reply: {
            id: fresh,
            author: { account_id: s.mate.accountId, display_name: 'Olga Owner' },
            position_at: ago(30).toISOString(),
          },
        },
      });
      expect(await counts(s.ws)).toMatchObject({ replies: 2, attempts: 0, jobs: 0 });
      const again = await post(s.me, `${s.url}/replies`, {
        ...payload,
        confirm_teammate_reply: true,
      });
      expect(again.statusCode).toBe(201);
      expect(await counts(s.ws)).toMatchObject({ replies: 3, attempts: 1, jobs: 1 });
    });

    it('treats a last_seen_reply_id of another conversation as none', async () => {
      const s = await seed();
      const other = await seed();
      const foreign = await insertReply(db, {
        workspaceId: other.ws,
        conversationId: other.conv,
        authorAccountId: other.me.accountId,
        state: 'sent',
      });
      await insertReply(db, {
        workspaceId: s.ws,
        conversationId: s.conv,
        authorAccountId: s.mate.accountId,
        state: 'sent',
        positionAt: ago(30),
      });
      const res = await post(
        s.me,
        `${s.url}/replies`,
        body('Mine', { last_seen_reply_id: foreign }),
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('TEAMMATE_REPLIED');
    });

    it('404 for a conversation of another workspace, an unknown one, and stores nothing (AC-18)', async () => {
      const s = await seed();
      const other = await seed();
      expect((await post(s.me, `${base(s.ws, other.conv)}/replies`, body())).statusCode).toBe(404);
      expect((await post(s.me, `${base(s.ws, newId())}/replies`, body())).statusCode).toBe(404);
      expect((await post(s.me, `${other.url}/replies`, body())).statusCode).toBe(404); // not a member there
      expect(await counts(other.ws)).toEqual({ replies: 0, attempts: 0, jobs: 0 });
    });

    it('401 when signed out; 415 for a non-JSON body', async () => {
      const s = await seed();
      expect((await post(null, `${s.url}/replies`, body())).statusCode).toBe(401);
      const res = await app.inject({
        method: 'POST',
        url: `${s.url}/replies`,
        cookies: s.me.cookies,
        headers: { 'content-type': 'text/plain' },
        payload: 'x',
      });
      expect(res.statusCode).toBe(415);
    });

    it('403 ACCESS_REMOVED for a deactivated member', async () => {
      const s = await seed();
      await db
        .updateTable('memberships')
        .set({ state: 'deactivated', deactivated_at: ago(60) })
        .where('account_id', '=', s.me.accountId)
        .execute();
      const res = await post(s.me, `${s.url}/replies`, body());
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('ACCESS_REMOVED');
    });
  });

  describe('resendReply', () => {
    const resendUrl = (s: { url: string }, id: string) => `${s.url}/replies/${id}/resend`;
    const failed = async (
      s: Awaited<ReturnType<typeof seed>>,
      state: 'not_delivered' | 'not_confirmed' | 'sending' | 'sent',
    ) =>
      insertReply(db, {
        workspaceId: s.ws,
        conversationId: s.conv,
        authorAccountId: s.mate.accountId,
        state,
        positionAt: ago(120),
      });

    it('re-queues a not_delivered reply: sending, new position, try_again attempt, one job', async () => {
      const s = await seed();
      const id = await failed(s, 'not_delivered');
      const res = await post(s.me, resendUrl(s, id), {});
      expect(res.statusCode).toBe(200);
      expect(ThreadReply.parse(res.json())).toMatchObject({
        id,
        state: 'sending',
        failure_reason: null,
        position_at: NOW.toISOString(),
        author: { account_id: s.mate.accountId },
      });
      const attempt = await db
        .selectFrom('reply_attempts')
        .select(['kind', 'initiated_by_account_id'])
        .where('reply_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(attempt).toEqual({ kind: 'try_again', initiated_by_account_id: s.me.accountId });
      expect(await counts(s.ws)).toMatchObject({ attempts: 1, jobs: 1 });
    });

    it('409 DUPLICATE_RISK_CONFIRMATION_REQUIRED for not_confirmed without confirmation; nothing changes (AC-11)', async () => {
      const s = await seed();
      const id = await failed(s, 'not_confirmed');
      const res = await post(s.me, resendUrl(s, id), {});
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('DUPLICATE_RISK_CONFIRMATION_REQUIRED');
      expect(await counts(s.ws)).toMatchObject({ attempts: 0, jobs: 0 });
      const row = await db
        .selectFrom('replies')
        .select('state')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('not_confirmed');
      const ok = await post(s.me, resendUrl(s, id), { confirm_duplicate_risk: true });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().state).toBe('sending');
      const attempt = await db
        .selectFrom('reply_attempts')
        .select('kind')
        .where('reply_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(attempt.kind).toBe('send_again');
    });

    it.each(['sending', 'sent'] as const)(
      '409 REPLY_NOT_RESENDABLE for a %s reply with it in details',
      async (state) => {
        const s = await seed();
        const id = await failed(s, state);
        const res = await post(s.me, resendUrl(s, id), {});
        expect(res.statusCode).toBe(409);
        const error = ErrorEnvelope.parse(res.json()).error;
        expect(error.code).toBe('REPLY_NOT_RESENDABLE');
        expect(ThreadReply.parse((error.details as { reply: unknown }).reply)).toMatchObject({
          id,
          state,
        });
        expect(await counts(s.ws)).toMatchObject({ attempts: 0, jobs: 0 });
      },
    );

    it('409 BOT_CANNOT_REPLY comes last and leaves the reply as it was (AC-13)', async () => {
      const s = await seed('needs_token');
      const id = await failed(s, 'not_delivered');
      const res = await post(s.me, resendUrl(s, id), {});
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('BOT_CANNOT_REPLY');
      expect(await counts(s.ws)).toMatchObject({ attempts: 0, jobs: 0 });
      const row = await db
        .selectFrom('replies')
        .select(['state', 'position_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ state: 'not_delivered', position_at: ago(120) });
    });

    it('429 over the limit beats a broken bot and keeps the reply state (AC-12b)', async () => {
      const s = await seed('needs_token');
      const id = await failed(s, 'not_delivered');
      for (let i = 0; i < 30; i++) {
        const r = await insertReply(db, {
          workspaceId: s.ws,
          conversationId: s.conv,
          authorAccountId: s.me.accountId,
        });
        await insertReplyAttempt(db, {
          workspaceId: s.ws,
          conversationId: s.conv,
          replyId: r,
          initiatedByAccountId: s.me.accountId,
          createdAt: ago(10),
        });
      }
      const res = await post(s.me, resendUrl(s, id), {});
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('50');
      expect(res.json().error.details).toMatchObject({ retry_at: ago(-50).toISOString() });
      const row = await db
        .selectFrom('replies')
        .select('state')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('not_delivered');
    });

    it("404 for an unknown reply and for another workspace's reply", async () => {
      const s = await seed();
      const other = await seed();
      const foreign = await failed(other, 'not_delivered');
      expect((await post(s.me, resendUrl(s, newId()), {})).statusCode).toBe(404);
      expect((await post(s.me, resendUrl(s, foreign), {})).statusCode).toBe(404);
      expect(
        (await post(s.me, `${base(s.ws, other.conv)}/replies/${foreign}/resend`, {})).statusCode,
      ).toBe(404);
      const row = await db
        .selectFrom('replies')
        .select('state')
        .where('id', '=', foreign)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('not_delivered');
    });

    it('401 when signed out', async () => {
      const s = await seed();
      expect((await post(null, resendUrl(s, newId()), {})).statusCode).toBe(401);
    });
  });
});
