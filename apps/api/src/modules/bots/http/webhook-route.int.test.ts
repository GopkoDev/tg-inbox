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
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
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
});
