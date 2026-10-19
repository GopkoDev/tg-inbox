import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertBot, type InsertedBot } from '../../../test/fixtures/bots.js';
import {
  MESSAGE_KIND_FIXTURES,
  signedDelivery,
  telegramEdit,
  telegramUpdate,
} from '../../../test/fixtures/telegram.js';
import { insertConnectLink, insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const T = new Date('2026-10-11T10:00:00Z');
const T_S = T.getTime() / 1000;
const SECRET_TEXT = 'Very private text 4c1f';

describe('POST /api/telegram/webhook/:botId (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;
  const lines: string[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    app = await buildApp(
      { ...testConfig(database.url), LOG_LEVEL: 'info' },
      { clock: fixedClock(new Date(T.getTime() + 3_600_000)), logStream },
    );
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });
  beforeEach(() => {
    lines.length = 0;
  });

  const connectedBot = async (state: 'connected' | 'needs_token' | 'taken_over' = 'connected') => {
    const workspaceId = await insertWorkspace(db, 'Acme Flowers');
    const inserted = await insertBot(db, { workspaceId, state, connectedAt: T });
    return {
      workspaceId,
      ...inserted,
      auth: { id: inserted.bot.id, secret: inserted.webhookSecret! },
    };
  };
  const deliver = (b: { auth: { id: string; secret: string } }, update: unknown) =>
    signedDelivery(app, b.auth, update);
  const messagesOf = (workspaceId: string) =>
    db
      .selectFrom('messages')
      .select(['telegram_message_id', 'kind', 'body', 'edited_at'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('telegram_message_id')
      .execute();
  const counts = async (workspaceId: string) => {
    const count = async (table: 'contacts' | 'conversations' | 'messages') =>
      Number(
        (
          await db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll().as('n'))
            .where('workspace_id', '=', workspaceId)
            .executeTakeFirstOrThrow()
        ).n,
      );
    return {
      contacts: await count('contacts'),
      conversations: await count('conversations'),
      messages: await count('messages'),
    };
  };

  it('AC-07: a first message → 200 empty; contact, conversation and message captured', async () => {
    const b = await connectedBot();
    const res = await deliver(
      b,
      telegramUpdate({
        updateId: 1,
        messageId: 1,
        date: T_S + 10,
        fromId: 770001,
        text: '/start',
        from: { first_name: 'Olena', username: 'olena_t', language_code: 'uk' },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    const contact = await db
      .selectFrom('contacts')
      .select(['first_name', 'username', 'language_code'])
      .where('workspace_id', '=', b.workspaceId)
      .executeTakeFirstOrThrow();
    expect(contact).toEqual({ first_name: 'Olena', username: 'olena_t', language_code: 'uk' });
    expect(await counts(b.workspaceId)).toEqual({ contacts: 1, conversations: 1, messages: 1 });
    expect(await messagesOf(b.workspaceId)).toMatchObject([{ kind: 'text', body: '/start' }]);
  });

  it('AC-09: every kind — incl. other — and each album item as its own message, with captions', async () => {
    const b = await connectedBot();
    const kinds = Object.keys(MESSAGE_KIND_FIXTURES);
    let id = 0;
    for (const kind of kinds) {
      id += 1;
      const res = await deliver(
        b,
        telegramUpdate({
          updateId: id,
          messageId: id,
          date: T_S + id,
          fromId: 770002,
          kind,
          caption: `caption ${kind}`,
        }),
      );
      expect(res.statusCode, kind).toBe(200);
    }
    for (const n of [1, 2]) {
      id += 1;
      await deliver(
        b,
        telegramUpdate({
          updateId: id,
          messageId: id,
          date: T_S + id,
          fromId: 770002,
          kind: 'photo',
          mediaGroupId: 'album-1',
          caption: n === 1 ? 'album' : undefined,
        }),
      );
    }
    const rows = await messagesOf(b.workspaceId);
    expect(rows).toHaveLength(kinds.length + 2);
    expect(rows.map((r) => r.kind).slice(0, kinds.length)).toEqual(
      kinds.map((k) => (k === 'other' ? 'other' : k)),
    );
    expect(rows.find((r) => r.kind === 'photo')?.body).toBe('caption photo');
    expect(rows.slice(-2).map((r) => r.kind)).toEqual(['photo', 'photo']);
  });

  it('AC-10: an edit replaces the text in place; out-of-order edits keep the latest; an uncaptured edit adds nothing', async () => {
    const b = await connectedBot();
    await deliver(
      b,
      telegramUpdate({ updateId: 1, messageId: 1, date: T_S + 10, fromId: 770003, text: 'v1' }),
    );
    const later = telegramEdit({
      updateId: 3,
      messageId: 1,
      date: T_S + 10,
      fromId: 770003,
      text: 'v3',
      editDate: T_S + 30,
    });
    const earlier = telegramEdit({
      updateId: 2,
      messageId: 1,
      date: T_S + 10,
      fromId: 770003,
      text: 'v2',
      editDate: T_S + 20,
    });
    expect((await deliver(b, later)).statusCode).toBe(200);
    expect((await deliver(b, earlier)).statusCode).toBe(200);
    const ghost = telegramEdit({
      updateId: 4,
      messageId: 99,
      date: T_S + 10,
      fromId: 770003,
      text: 'x',
      editDate: T_S + 40,
    });
    expect((await deliver(b, ghost)).statusCode).toBe(200);
    const rows = await messagesOf(b.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: 'v3' });
    expect(rows[0]!.edited_at).not.toBeNull();
  });

  it('AC-11: a redelivery is stored once; a lower id after a higher one reads back in Telegram order', async () => {
    const b = await connectedBot();
    const second = telegramUpdate({
      updateId: 2,
      messageId: 2,
      date: T_S + 20,
      fromId: 770004,
      text: 'second',
    });
    const first = telegramUpdate({
      updateId: 1,
      messageId: 1,
      date: T_S + 10,
      fromId: 770004,
      text: 'first',
    });
    await deliver(b, second);
    await deliver(b, first);
    expect((await deliver(b, second)).statusCode).toBe(200);
    expect((await messagesOf(b.workspaceId)).map((r) => r.body)).toEqual(['first', 'second']);
  });

  it('AC-12: group, channel, bot and business messages are ignored with 200 and capture nothing', async () => {
    const b = await connectedBot();
    const base = { messageId: 1, date: T_S + 10, fromId: 770005 };
    const updates = [
      telegramUpdate({ ...base, updateId: 1, chatType: 'group' }),
      telegramUpdate({ ...base, updateId: 2, chatType: 'supergroup' }),
      telegramUpdate({ ...base, updateId: 3, chatType: 'channel' }),
      telegramUpdate({ ...base, updateId: 4, fromIsBot: true }),
      telegramUpdate({ ...base, updateId: 5, businessConnectionId: 'biz-1' }),
      { update_id: 6, not_an_update: true },
    ];
    for (const u of updates) {
      const res = await deliver(b, u);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('');
    }
    expect(await counts(b.workspaceId)).toEqual({ contacts: 0, conversations: 0, messages: 0 });
  });

  it('a bot needing a new token still captures with the right secret', async () => {
    const b = await connectedBot('needs_token');
    const res = await deliver(
      b,
      telegramUpdate({ updateId: 1, messageId: 1, date: T_S + 10, fromId: 770006 }),
    );
    expect(res.statusCode).toBe(200);
    expect((await counts(b.workspaceId)).messages).toBe(1);
  });

  it('AC-14: missing / wrong / another bot’s secret, unknown and malformed ids → identical empty 401, nothing recorded', async () => {
    const b = await connectedBot();
    const other = await connectedBot();
    const update = telegramUpdate({ updateId: 1, messageId: 1, date: T_S + 10, fromId: 770007 });
    const responses = [
      await app.inject({
        method: 'POST',
        url: `/api/telegram/webhook/${b.auth.id}`,
        payload: update as object,
      }),
      await signedDelivery(app, { id: b.auth.id, secret: 'wrong-secret' }, update),
      await signedDelivery(app, { id: b.auth.id, secret: other.auth.secret }, update),
      await signedDelivery(
        app,
        { id: '0190a000-0000-7000-8000-000000000000', secret: b.auth.secret },
        update,
      ),
      await signedDelivery(app, { id: 'not-a-uuid', secret: b.auth.secret }, update),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('');
      expect(res.headers['content-type']).toBeUndefined();
    }
    expect(await counts(b.workspaceId)).toEqual({ contacts: 0, conversations: 0, messages: 0 });
    expect(await counts(other.workspaceId)).toEqual({ contacts: 0, conversations: 0, messages: 0 });
  });

  it('the secret is checked before the body is parsed: a forged malformed body is 401, not 400', async () => {
    const b = await connectedBot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/telegram/webhook/${b.auth.id}`,
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'nope' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('');
  });

  it('AC-18: a delivery after disconnect (secret hash cleared) is 401', async () => {
    const b = await connectedBot();
    await db
      .updateTable('bots')
      .set({
        state: 'disconnected',
        token_encrypted: null,
        webhook_secret_hash: null,
        connected_at: null,
        last_checked_at: null,
      })
      .where('id', '=', b.auth.id)
      .execute();
    const res = await deliver(
      b,
      telegramUpdate({ updateId: 1, messageId: 1, date: T_S + 10, fromId: 770008 }),
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('');
  });

  it('ADR-0003: a database failure answers 500; the redelivery is then captured once', async () => {
    const b = await connectedBot();
    const update = telegramUpdate({
      updateId: 1,
      messageId: 1,
      date: T_S + 10,
      fromId: 770009,
      text: SECRET_TEXT,
    });
    await sql`alter table messages rename to messages_offline`.execute(db);
    let failed;
    try {
      failed = await deliver(b, update);
    } finally {
      await sql`alter table messages_offline rename to messages`.execute(db);
    }
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(await counts(b.workspaceId)).toEqual({ contacts: 0, conversations: 0, messages: 0 });

    expect((await deliver(b, update)).statusCode).toBe(200);
    expect((await deliver(b, update)).statusCode).toBe(200);
    expect(await counts(b.workspaceId)).toEqual({ contacts: 1, conversations: 1, messages: 1 });
  });

  it('logs ingest_ms and the outcome with bot id and update id — never the secret or the message text', async () => {
    const b: { auth: { id: string; secret: string } } & InsertedBot = await connectedBot();
    await deliver(
      b,
      telegramUpdate({
        updateId: 4242,
        messageId: 1,
        date: T_S + 10,
        fromId: 770010,
        text: SECRET_TEXT,
        caption: SECRET_TEXT,
      }),
    );
    await deliver(
      b,
      telegramUpdate({
        updateId: 4243,
        messageId: 2,
        date: T_S + 11,
        fromId: 770010,
        kind: 'photo',
        caption: SECRET_TEXT,
      }),
    );
    await signedDelivery(app, { id: b.auth.id, secret: 'forged-secret-value' }, {});
    const ingest = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => 'ingest_ms' in l);
    expect(ingest.length).toBeGreaterThanOrEqual(2);
    expect(ingest[0]).toMatchObject({ botId: b.auth.id, updateId: 4242, outcome: 'captured' });
    expect(typeof ingest[0]!.ingest_ms).toBe('number');
    const all = lines.join('\n');
    expect(all).not.toContain(b.auth.secret);
    expect(all).not.toContain('forged-secret-value');
    expect(all).not.toContain(SECRET_TEXT);
    expect(all).not.toContain(b.token);
  });

  describe('inbound interceptor: connect-link starts and linked members (AC-04, AC-05, AC-06, AC-11)', () => {
    const LINKED_USER = 880001;
    const botMessageJobs = async () =>
      (
        await sql<{ data: Record<string, unknown> }>`
          select data from pgboss.job where name = 'notifications.send-bot-message' order by created_on
        `.execute(db)
      ).rows.map((r) => r.data);
    const noCustomerRows = async (workspaceId: string) =>
      expect(await counts(workspaceId)).toEqual({ contacts: 0, conversations: 0, messages: 0 });

    /** A connected bot with an active member who may have a link (made with this bot). */
    const withMember = async (o: { linked?: boolean } = {}) => {
      const b = await connectedBot();
      const m = await insertMembership(db, b.workspaceId);
      const link = o.linked
        ? await insertTelegramLink(db, {
            workspaceId: b.workspaceId,
            accountId: m.accountId,
            telegramBotId: b.bot.telegramBotId,
            telegramUserId: BigInt(LINKED_USER),
          })
        : null;
      return { ...b, member: m, link };
    };
    const liveLinks = (workspaceId: string) =>
      db
        .selectFrom('telegram_links')
        .select(['account_id', 'telegram_user_id', 'display_name'])
        .where('workspace_id', '=', workspaceId)
        .where('removed_at', 'is', null)
        .execute();
    const start = (text: string, fromId: number, n = 1) =>
      telegramUpdate({ updateId: n, messageId: n, date: T_S + 10 + n, fromId, text });

    it('a connect-link start links the member, answers once and is never captured', async () => {
      const b = await withMember();
      const issued = await insertConnectLink(db, {
        workspaceId: b.workspaceId,
        accountId: b.member.accountId,
        createdAt: new Date(T.getTime() + 3_600_000 - 60_000),
      });
      const before = (await botMessageJobs()).length;
      const res = await deliver(b, start(`/start ${issued.startPayload}`, LINKED_USER));
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('');
      expect(await liveLinks(b.workspaceId)).toEqual([
        {
          account_id: b.member.accountId,
          telegram_user_id: String(LINKED_USER),
          display_name: 'Test User',
        },
      ]);
      await noCustomerRows(b.workspaceId);
      const jobs = (await botMessageJobs()).slice(before);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ workspace_id: b.workspaceId, kind: 'connected' });
      // The token (and so its hash) never reaches the logs.
      expect(lines.join('\n')).not.toContain(issued.token);
    });

    it('an unknown, used or expired connect link is answered link_expired and never captured', async () => {
      const b = await withMember();
      const used = await insertConnectLink(db, {
        workspaceId: b.workspaceId,
        accountId: b.member.accountId,
        createdAt: new Date(T.getTime() + 3_600_000 - 60_000),
        usedAt: new Date(T.getTime() + 3_600_000 - 30_000),
      });
      const old = await insertConnectLink(db, {
        workspaceId: b.workspaceId,
        accountId: b.member.accountId,
        createdAt: new Date(T.getTime() - 3_600_000),
      });
      const before = (await botMessageJobs()).length;
      for (const [n, payload] of [
        `tgi_${'z'.repeat(43)}`,
        used.startPayload,
        old.startPayload,
      ].entries()) {
        expect((await deliver(b, start(`/start ${payload}`, 880100 + n, n + 1))).statusCode).toBe(
          200,
        );
      }
      expect(await liveLinks(b.workspaceId)).toEqual([]);
      await noCustomerRows(b.workspaceId);
      const jobs = (await botMessageJobs()).slice(before);
      expect(jobs.map((j) => j.kind)).toEqual(['link_expired', 'link_expired', 'link_expired']);
      expect(jobs.map((j) => j.telegram_user_id)).toEqual(['880100', '880101', '880102']);
    });

    it('a flood of fake starts from one Telegram user queues one refusal answer a minute (B2, AC-05)', async () => {
      const b = await withMember();
      // The throttle is a one-minute slot: start the flood well inside one.
      for (;;) {
        const { rows } = await sql<{
          s: number;
        }>`select extract(second from now())::int as s`.execute(db);
        if (rows[0]!.s < 45) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      const before = (await botMessageJobs()).length;
      for (let n = 1; n <= 12; n += 1) {
        const fake = `tgi_${String(n).padStart(2, '0')}${'q'.repeat(41)}`;
        expect((await deliver(b, start(`/start ${fake}`, 880200, 100 + n))).statusCode).toBe(200);
      }
      // Another user's refusal is not held back by the first one's.
      expect(
        (await deliver(b, start(`/start tgi_${'w'.repeat(43)}`, 880201, 200))).statusCode,
      ).toBe(200);
      await noCustomerRows(b.workspaceId);
      const jobs = (await botMessageJobs()).slice(before);
      expect(jobs.map((j) => [j.kind, j.telegram_user_id])).toEqual([
        ['link_expired', '880200'],
        ['link_expired', '880201'],
      ]);
    });

    it('anything from a linked sender is consumed: text, media, edit, campaign start - at most one notice an hour', async () => {
      const b = await withMember({ linked: true });
      const before = (await botMessageJobs()).length;
      const sent = [
        start('ok', LINKED_USER, 1),
        telegramUpdate({
          updateId: 2,
          messageId: 2,
          date: T_S + 20,
          fromId: LINKED_USER,
          kind: 'photo',
          caption: 'x',
        }),
        telegramUpdate({
          updateId: 3,
          messageId: 3,
          date: T_S + 21,
          fromId: LINKED_USER,
          kind: 'voice',
        }),
        telegramEdit({
          updateId: 4,
          messageId: 1,
          date: T_S + 11,
          editDate: T_S + 30,
          fromId: LINKED_USER,
          text: 'ok!',
        }),
        start('/start promo', LINKED_USER, 5),
      ];
      for (const update of sent) {
        const res = await deliver(b, update);
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('');
      }
      await noCustomerRows(b.workspaceId);
      const jobs = (await botMessageJobs()).slice(before);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        workspace_id: b.workspaceId,
        kind: 'chat_only_notifications',
        telegram_link_id: b.link!.id,
      });
      const row = await db
        .selectFrom('telegram_links')
        .select('last_notice_at')
        .where('id', '=', b.link!.id)
        .executeTakeFirstOrThrow();
      expect(row.last_notice_at).not.toBeNull();
    });

    it('a connect-link start by an already linked sender is redeemed, not just consumed', async () => {
      const b = await withMember({ linked: true });
      const issued = await insertConnectLink(db, {
        workspaceId: b.workspaceId,
        accountId: b.member.accountId,
        createdAt: new Date(T.getTime() + 3_600_000 - 60_000),
      });
      const before = (await botMessageJobs()).length;
      await deliver(b, start(`/start ${issued.startPayload}`, LINKED_USER));
      const jobs = (await botMessageJobs()).slice(before);
      expect(jobs.map((j) => j.kind)).toEqual(['already_connected']);
      await noCustomerRows(b.workspaceId);
    });

    it('unlinked senders and a campaign start without a link are captured as before', async () => {
      const b = await withMember();
      await deliver(b, start('/start promo', 880200, 1));
      await deliver(b, start('hello', 880201, 2));
      expect(await counts(b.workspaceId)).toEqual({ contacts: 2, conversations: 2, messages: 2 });
      expect(await botMessageJobs()).toEqual(
        (await botMessageJobs()).filter((j) => j.workspace_id !== b.workspaceId),
      );
    });

    it('a disconnected member is captured as an end customer again; earlier messages stay', async () => {
      const b = await withMember();
      await deliver(b, start('before linking', LINKED_USER, 1));
      const link = await insertTelegramLink(db, {
        workspaceId: b.workspaceId,
        accountId: b.member.accountId,
        telegramBotId: b.bot.telegramBotId,
        telegramUserId: BigInt(LINKED_USER),
      });
      await deliver(b, start('while linked', LINKED_USER, 2));
      expect((await messagesOf(b.workspaceId)).map((r) => r.body)).toEqual(['before linking']);
      await db
        .updateTable('telegram_links')
        .set({ removed_at: T, removed_reason: 'member', display_name: null })
        .where('id', '=', link.id)
        .execute();
      await deliver(b, start('after disconnect', LINKED_USER, 3));
      expect((await messagesOf(b.workspaceId)).map((r) => r.body)).toEqual([
        'before linking',
        'after disconnect',
      ]);
    });

    it('a link made with another bot does not consume messages to this bot', async () => {
      const b = await connectedBot();
      const m = await insertMembership(db, b.workspaceId);
      await insertTelegramLink(db, {
        workspaceId: b.workspaceId,
        accountId: m.accountId,
        telegramBotId: b.bot.telegramBotId + 1n,
        telegramUserId: BigInt(LINKED_USER),
      });
      await deliver(b, start('hi', LINKED_USER));
      expect((await counts(b.workspaceId)).messages).toBe(1);
    });

    it('a failing lookup answers 500 and writes nothing; the redelivery works', async () => {
      const b = await withMember({ linked: true });
      await sql`alter table telegram_links rename to telegram_links_offline`.execute(db);
      let failed;
      try {
        failed = await deliver(b, start('ok', LINKED_USER));
      } finally {
        await sql`alter table telegram_links_offline rename to telegram_links`.execute(db);
      }
      expect(failed.statusCode).toBe(500);
      await noCustomerRows(b.workspaceId);
      expect((await deliver(b, start('ok', LINKED_USER))).statusCode).toBe(200);
      await noCustomerRows(b.workspaceId);
    });
  });
});
