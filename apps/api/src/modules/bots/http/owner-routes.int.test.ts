import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BotSettings, ErrorEnvelope } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { fakeBotToken, insertBot } from '../../../test/fixtures/bots.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-11T10:00:00Z');
const BASE_URL = 'https://tg-inbox.example.test';
const OWNER_ONLY = 'Only business owners manage the bot';

describe('owner-only bot routes (postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let db: Db;
  let nextBotId = 510000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    app = await buildApp(
      { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot },
      { clock: fixedClock(NOW) },
    );
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await fake?.stop();
    await db?.destroy();
    await database?.stop();
  });
  beforeEach(() => fake.reset());

  type Who = { cookies: { session: string } };
  const member = async (
    workspaceId: string,
    role: 'owner' | 'operator',
    state: 'active' | 'deactivated' = 'active',
  ): Promise<Who> => {
    const account = await insertAccount(db);
    const session = await insertSession(db, account.id, {
      createdAt: new Date('2026-10-11T09:00:00Z'),
    });
    await insertMembership(db, workspaceId, { accountId: account.id, role, state });
    return { cookies: { session: session.token } };
  };
  const call = (who: Who, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who.cookies, ...(payload && { payload }) });
  const bot = (ws: string) => `/api/workspaces/${ws}/bot`;
  const newToken = () => fakeBotToken(nextBotId++);
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;
  const ownerOf = async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    return { ws, owner: await member(ws, 'owner') };
  };
  const botRow = (ws: string) =>
    db.selectFrom('bots').selectAll().where('workspace_id', '=', ws).executeTakeFirst();

  it('AC-15: GET bot settings — not connected, then connected with no Telegram call and no token', async () => {
    const { ws, owner } = await ownerOf();
    const empty = await call(owner, 'GET', bot(ws));
    expect(empty.statusCode).toBe(200);
    expect(BotSettings.parse(empty.json())).toEqual({ state: 'not_connected' });

    const inserted = await insertBot(db, { workspaceId: ws, username: 'acme_flowers_bot' });
    const res = await call(owner, 'GET', bot(ws));
    expect(res.statusCode).toBe(200);
    expect(BotSettings.parse(res.json())).toEqual({
      state: 'connected',
      bot: { name: inserted.bot.name, username: 'acme_flowers_bot' },
      last_checked_at: NOW.toISOString(),
      last_message_received_at: null,
      contacts_count: 0,
    });
    expect(res.body).not.toContain(inserted.token);
    expect(fake.calls()).toHaveLength(0);
  });

  it('AC-01: pasting a token (with spaces) connects the bot; the answer never carries the token', async () => {
    const { ws, owner } = await ownerOf();
    const token = newToken();
    fake
      .bot(token)
      .script({ me: { first_name: 'Acme Flowers Support', username: 'acme_support_bot' } });
    const res = await call(owner, 'POST', `${bot(ws)}/token`, { token: `  ${token} ` });
    expect(res.statusCode).toBe(200);
    expect(BotSettings.parse(res.json())).toMatchObject({
      state: 'connected',
      bot: { name: 'Acme Flowers Support', username: 'acme_support_bot' },
    });
    expect(res.body).not.toContain(token);
    const row = await botRow(ws);
    expect(row?.state).toBe('connected');
    expect(res.body).not.toContain(row!.id);
    const set = fake.calls(token).find((c) => c.method === 'setWebhook');
    expect(set?.params.url).toBe(`${BASE_URL}/api/telegram/webhook/${row!.id}`);
    expect(res.body).not.toContain(String(set?.params.secret_token));
  });

  it('AC-02: a malformed or rejected token is 400 BOT_TOKEN_INVALID and changes nothing', async () => {
    const { ws, owner } = await ownerOf();
    for (const token of ['not a token', newToken() /* never scripted → 401 */]) {
      const res = await call(owner, 'POST', `${bot(ws)}/token`, { token });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toEqual({
        code: 'BOT_TOKEN_INVALID',
        message: 'The token is not valid — copy it again from BotFather',
      });
    }
    expect(await botRow(ws)).toBeUndefined();
  });

  it('400 VALIDATION_ERROR for a token over 512 characters or an unknown field', async () => {
    const { ws, owner } = await ownerOf();
    for (const body of [{ token: 'x'.repeat(513) }, { token: newToken(), extra: 1 }, {}]) {
      const res = await call(owner, 'POST', `${bot(ws)}/token`, body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it('AC-04: a bot bound to another workspace is 409 without naming it', async () => {
    const other = await insertWorkspace(db, 'Secret Other Shop');
    const theirs = await insertBot(db, { workspaceId: other });
    fake.bot(theirs.token).script({});
    const { ws, owner } = await ownerOf();
    const res = await call(owner, 'POST', `${bot(ws)}/token`, { token: theirs.token });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('BOT_BELONGS_TO_ANOTHER_WORKSPACE');
    expect(res.body).not.toContain('Secret Other Shop');
    expect(res.body).not.toContain(other);
    expect(await botRow(ws)).toBeUndefined();
  });

  it('AC-04: a bot another workspace disconnected after capturing is still 409, unnamed', async () => {
    const other = await insertWorkspace(db, 'Secret History Shop');
    const theirs = await insertBot(db, { workspaceId: other, state: 'disconnected' });
    fake.bot(theirs.token).script({});
    const { ws, owner } = await ownerOf();
    const res = await call(owner, 'POST', `${bot(ws)}/token`, { token: theirs.token });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('BOT_BELONGS_TO_ANOTHER_WORKSPACE');
    expect(res.body).not.toContain('Secret History Shop');
    expect(res.body).not.toContain(other);
    expect(await botRow(ws)).toBeUndefined();
  });

  it('AC-05: a different bot while one is connected is 409 WORKSPACE_KEEPS_ONE_BOT {reason}', async () => {
    const { ws, owner } = await ownerOf();
    await insertBot(db, { workspaceId: ws });
    const token = newToken();
    fake.bot(token).script({});
    const res = await call(owner, 'POST', `${bot(ws)}/token`, { token });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'WORKSPACE_KEEPS_ONE_BOT',
      details: { reason: 'connected' },
    });
  });

  it('AC-06: a foreign webhook asks for confirmation; the confirmed resubmission connects', async () => {
    const { ws, owner } = await ownerOf();
    const token = newToken();
    fake.bot(token).script({ webhookUrl: 'https://other-service.example/hook' });
    const first = await call(owner, 'POST', `${bot(ws)}/token`, { token });
    expect(first.statusCode).toBe(409);
    const err = errorOf(first);
    expect(err.code).toBe('TAKEOVER_CONFIRMATION_REQUIRED');
    expect(err.details).toEqual({
      bot: { name: `Test Bot ${token.split(':')[0]}`, username: `test_bot_${token.split(':')[0]}` },
    });
    expect(await botRow(ws)).toBeUndefined();
    expect(fake.calls(token).some((c) => c.method === 'setWebhook')).toBe(false);

    const confirmed = await call(owner, 'POST', `${bot(ws)}/token`, {
      token,
      confirm_takeover: true,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(BotSettings.parse(confirmed.json()).state).toBe('connected');
  });

  it('503 TELEGRAM_UNAVAILABLE when Telegram fails; nothing changes', async () => {
    const { ws, owner } = await ownerOf();
    const token = newToken();
    fake.bot(token).script({ getMe: 'server_error' });
    const res = await call(owner, 'POST', `${bot(ws)}/token`, { token });
    expect(res.statusCode).toBe(503);
    expect(errorOf(res)).toEqual({
      code: 'TELEGRAM_UNAVAILABLE',
      message: 'Telegram is not responding — try again',
    });
    expect(await botRow(ws)).toBeUndefined();
  });

  it('AC-16b: reconnect — 409 NOTHING_TO_RECONNECT with settings when connected; taken over → confirm → 200', async () => {
    const { ws, owner } = await ownerOf();
    const connected = await call(owner, 'POST', `${bot(ws)}/reconnect`, {});
    expect(connected.statusCode).toBe(409);
    expect(errorOf(connected)).toMatchObject({
      code: 'NOTHING_TO_RECONNECT',
      details: { settings: { state: 'not_connected' } },
    });

    const taken = await insertBot(db, { workspaceId: ws, state: 'taken_over' });
    fake.bot(taken.token).script({ webhookUrl: 'https://other-service.example/hook' });
    const warn = await call(owner, 'POST', `${bot(ws)}/reconnect`, {});
    expect(warn.statusCode).toBe(409);
    expect(errorOf(warn).code).toBe('TAKEOVER_CONFIRMATION_REQUIRED');
    const ok = await call(owner, 'POST', `${bot(ws)}/reconnect`, { confirm_takeover: true });
    expect(ok.statusCode).toBe(200);
    expect(BotSettings.parse(ok.json()).state).toBe('connected');
    expect(ok.body).not.toContain(taken.token);
  });

  it('reconnect with a revoked stored token is 409 BOT_NEEDS_NEW_TOKEN with the new settings', async () => {
    const { ws, owner } = await ownerOf();
    const taken = await insertBot(db, { workspaceId: ws, state: 'taken_over' });
    fake.bot(taken.token).script({ getMe: 'unauthorized' });
    const res = await call(owner, 'POST', `${bot(ws)}/reconnect`, { confirm_takeover: true });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'BOT_NEEDS_NEW_TOKEN',
      details: { settings: { state: 'needs_token' } },
    });
  });

  it('reconnect without a body is 400 VALIDATION_ERROR', async () => {
    const { ws, owner } = await ownerOf();
    const res = await app.inject({
      method: 'POST',
      url: `${bot(ws)}/reconnect`,
      cookies: owner.cookies,
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
  });

  it('AC-18: disconnect removes our webhook and answers not_connected; again → 409 NO_BOT_CONNECTED', async () => {
    const { ws, owner } = await ownerOf();
    const inserted = await insertBot(db, { workspaceId: ws });
    fake.bot(inserted.token).script({
      webhookUrl: `${BASE_URL}/api/telegram/webhook/${inserted.bot.id}`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `${bot(ws)}/disconnect`,
      cookies: owner.cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(BotSettings.parse(res.json())).toEqual({ state: 'not_connected' });
    expect(fake.calls(inserted.token).some((c) => c.method === 'deleteWebhook')).toBe(true);
    expect(await botRow(ws)).toBeUndefined();

    const again = await app.inject({
      method: 'POST',
      url: `${bot(ws)}/disconnect`,
      cookies: owner.cookies,
    });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toMatchObject({
      code: 'NO_BOT_CONNECTED',
      details: { settings: { state: 'not_connected' } },
    });
  });

  it('disconnect: 503 when Telegram fails (bot stays connected); 400 for an empty JSON body; 415 for non-JSON', async () => {
    const { ws, owner } = await ownerOf();
    const inserted = await insertBot(db, { workspaceId: ws });
    fake.bot(inserted.token).script({ getWebhookInfo: 'fail' });
    const failed = await app.inject({
      method: 'POST',
      url: `${bot(ws)}/disconnect`,
      cookies: owner.cookies,
    });
    expect(failed.statusCode).toBe(503);
    expect((await botRow(ws))?.state).toBe('connected');

    const empty = await app.inject({
      method: 'POST',
      url: `${bot(ws)}/disconnect`,
      cookies: owner.cookies,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(empty.statusCode).toBe(400);
    expect(errorOf(empty).code).toBe('VALIDATION_ERROR');

    const text = await app.inject({
      method: 'POST',
      url: `${bot(ws)}/token`,
      cookies: owner.cookies,
      headers: { 'content-type': 'text/plain' },
      payload: 'token',
    });
    expect(text.statusCode).toBe(415);
  });

  it('413 for a body over the limit', async () => {
    const { ws, owner } = await ownerOf();
    const res = await call(owner, 'POST', `${bot(ws)}/token`, {
      token: 'x'.repeat(2 * 1024 * 1024),
    });
    expect(res.statusCode).toBe(413);
    expect(errorOf(res).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('AC-03: an operator is refused with OWNER_ONLY on all four routes; no Telegram call', async () => {
    const { ws } = await ownerOf();
    await insertBot(db, { workspaceId: ws });
    const op = await member(ws, 'operator');
    const calls: ['GET' | 'POST', string, object?][] = [
      ['GET', bot(ws)],
      ['POST', `${bot(ws)}/token`, { token: newToken() }],
      ['POST', `${bot(ws)}/reconnect`, {}],
      ['POST', `${bot(ws)}/disconnect`],
    ];
    for (const [m, url, body] of calls) {
      const res = await call(op, m, url, body);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res)).toEqual({ code: 'OWNER_ONLY', message: OWNER_ONLY });
    }
    expect(fake.calls()).toHaveLength(0);
  });

  it('a deactivated owner gets ACCESS_REMOVED; no session is 401', async () => {
    const { ws } = await ownerOf();
    const gone = await member(ws, 'owner', 'deactivated');
    const res = await call(gone, 'GET', bot(ws));
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('ACCESS_REMOVED');
    const anon = await app.inject({ method: 'GET', url: bot(ws) });
    expect(anon.statusCode).toBe(401);
  });

  it('AC-03 / QG-1a: never-member, unknown and malformed workspace ids are 404; a foreign owner changes nothing', async () => {
    const acme = await insertWorkspace(db, 'Acme Flowers');
    const acmeBot = await insertBot(db, { workspaceId: acme });
    fake.bot(acmeBot.token).script({
      webhookUrl: `${BASE_URL}/api/telegram/webhook/${acmeBot.bot.id}`,
    });
    const before = await botRow(acme);
    const bolt = await insertWorkspace(db, 'Bolt Bikes');
    const boltOwner = await member(bolt, 'owner');
    const ids = [acme, '0190a000-0000-7000-8000-000000000000', 'not-a-uuid'];
    for (const ws of ids) {
      const calls: ['GET' | 'POST', string, object?][] = [
        ['GET', bot(ws)],
        ['POST', `${bot(ws)}/token`, { token: acmeBot.token }],
        ['POST', `${bot(ws)}/reconnect`, { confirm_takeover: true }],
        ['POST', `${bot(ws)}/disconnect`],
      ];
      for (const [m, url, body] of calls) {
        const res = await call(boltOwner, m, url, body);
        expect(res.statusCode, url).toBe(404);
        expect(res.body).not.toContain('Acme');
      }
    }
    expect(await botRow(acme)).toEqual(before);
    expect(fake.calls()).toHaveLength(0);
  });
});
