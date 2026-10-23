import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  BotIdentity,
  BotReconnect,
  BotSettings,
  BotTokenPaste,
  SettingsRefusalDetails,
  TakeoverConfirmationDetails,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { buildDeps } from '../../../deps.js';
import { newId } from '../../../platform/ids.js';
import { fixedClock } from '../../../platform/clock.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { fakeBotToken } from '../../../test/fixtures/bots.js';
import { signedDelivery, telegramEdit, telegramUpdate } from '../../../test/fixtures/telegram.js';
import { sendAnswers } from '../../../test/fake-telegram.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const START = new Date('2026-10-11T10:00:00Z');
const MINUTE = 60_000;

/**
 * Token secrecy (spec §6, test-plan §Token secrecy): every bot flow and every Telegram failure
 * branch runs against one app whose whole log is captured; no log line and no response body may
 * carry a bot token (or its secret part), a webhook secret, a message text or caption, or a
 * Bot API URL.
 */
describe('token secrecy across every bot flow (postgres + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let app: FastifyInstance;
  let deps: ReturnType<typeof buildDeps>;
  const clock = fixedClock(START);
  const lines: string[] = [];
  const bodies: string[] = [];
  const tokens: string[] = [];
  const texts: string[] = [];
  let nextBot = 930000n;
  let nextUpdate = 1;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = {
      ...testConfig(database.url),
      LOG_LEVEL: 'trace' as const,
      TELEGRAM_API_ROOT: fake.apiRoot,
    };
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    app = await buildApp(config, { clock, logStream });
    deps = buildDeps(config, { clock });
  });
  afterAll(async () => {
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });

  const newToken = (id = nextBot++) => {
    const token = fakeBotToken(id);
    tokens.push(token);
    return token;
  };
  const say = (text: string) => {
    texts.push(text);
    return text;
  };
  const record = (res: LightMyRequestResponse) => {
    bodies.push(res.body);
    return res;
  };

  async function owner() {
    const workspaceId = await insertWorkspace(deps.db, 'Acme Flowers');
    const account = await insertAccount(deps.db);
    const session = await insertSession(deps.db, account.id, { createdAt: START });
    await insertMembership(deps.db, workspaceId, { accountId: account.id, role: 'owner' });
    const cookies = { session: session.token };
    const bot = `/api/workspaces/${workspaceId}/bot`;
    return {
      workspaceId,
      cookies,
      get: async () => record(await app.inject({ method: 'GET', url: bot, cookies })),
      post: async (path: string, payload?: object) =>
        record(
          await app.inject({
            method: 'POST',
            url: `${bot}${path}`,
            cookies,
            ...(payload && { payload }),
          }),
        ),
    };
  }

  const webhookOf = (token: string) => {
    const set = fake
      .calls(token)
      .filter((c) => c.method === 'setWebhook')
      .at(-1)!;
    const url = String(set.params.url);
    return {
      id: url.slice(url.lastIndexOf('/') + 1),
      url,
      secret: String(set.params.secret_token),
    };
  };
  const deliver = async (hook: { id: string; secret: string }, update: unknown) =>
    record(await signedDelivery(app, hook, update));
  async function tick() {
    for (const { workspaceId, botId } of await deps.bots.healthCheck.scheduleChecks()) {
      await deps.bots.healthCheck.checkOne(workspaceId, botId);
    }
  }

  it('runs every flow and failure branch without leaking a secret', async () => {
    // --- connect: refusals first (unauthorized, transient, timeout, setWebhook failure) ---
    const acme = await owner();
    const rejected = newToken();
    fake.bot(rejected).script({ getMe: 'unauthorized' });
    expect((await acme.post('/token', { token: rejected })).statusCode).toBe(400);
    const down = newToken();
    fake.bot(down).script({ getMe: 'server_error' });
    expect((await acme.post('/token', { token: down })).statusCode).toBe(503);
    const limited = newToken();
    fake.bot(limited).script({ getMe: 'rate_limited' });
    expect((await acme.post('/token', { token: limited })).statusCode).toBe(503);
    const hanging = newToken();
    fake.bot(hanging).script({ getMe: 'hang' });
    expect((await acme.post('/token', { token: hanging })).statusCode).toBe(503);
    const noHook = newToken();
    fake.bot(noHook).script({ setWebhook: 'fail' });
    expect((await acme.post('/token', { token: noHook })).statusCode).toBe(503);
    const infoDown = newToken();
    fake.bot(infoDown).script({ getWebhookInfo: 'fail' });
    expect((await acme.post('/token', { token: infoDown })).statusCode).toBe(503);

    // --- connect with a takeover warning, then confirmed ---
    const botId = nextBot++;
    const token = newToken(botId);
    fake.bot(token).script({ webhookUrl: 'https://other-service.example/hook' });
    expect((await acme.post('/token', { token })).statusCode).toBe(409);
    expect((await acme.post('/token', { token, confirm_takeover: true })).statusCode).toBe(200);
    const hook = webhookOf(token);
    expect((await acme.get()).statusCode).toBe(200);

    // --- webhook: capture, caption, edit, forged secret, unknown bot, a failing database ---
    clock.advance(MINUTE);
    const t = Math.floor(clock.now().getTime() / 1000);
    const from = { fromId: 940001 };
    await deliver(
      hook,
      telegramUpdate({
        ...from,
        updateId: nextUpdate++,
        messageId: 1,
        date: t,
        text: say('My card ends 4242'),
      }),
    );
    await deliver(
      hook,
      telegramUpdate({
        ...from,
        updateId: nextUpdate++,
        messageId: 2,
        date: t,
        kind: 'photo',
        caption: say('Passport photo caption'),
      }),
    );
    await deliver(
      hook,
      telegramEdit({
        ...from,
        updateId: nextUpdate++,
        messageId: 1,
        date: t,
        text: say('My card ends 9999'),
        editDate: t + 5,
      }),
    );
    expect((await deliver({ id: hook.id, secret: 'forged-secret-0001' }, {})).statusCode).toBe(401);
    expect((await deliver({ id: 'not-a-uuid', secret: hook.secret }, {})).statusCode).toBe(401);
    await sql`alter table messages rename to messages_offline`.execute(deps.db);
    try {
      const failed = await deliver(
        hook,
        telegramUpdate({
          ...from,
          updateId: nextUpdate++,
          messageId: 3,
          date: t,
          text: say('Lost while the database was down'),
        }),
      );
      expect(failed.statusCode).toBe(500);
    } finally {
      await sql`alter table messages_offline rename to messages`.execute(deps.db);
    }

    // --- rotate ---
    const rotated = newToken(botId);
    fake.bot(rotated).script({ webhookUrl: hook.url });
    expect((await acme.post('/token', { token: rotated })).statusCode).toBe(200);

    // --- health check: transient, then taken over, reconnect (warning + confirm) ---
    fake.bot(rotated).script({ webhookUrl: hook.url, getMe: 'server_error' });
    clock.advance(4 * MINUTE);
    await tick();
    fake.bot(rotated).script({ webhookUrl: 'https://other-service.example/hook' });
    await tick();
    expect(JSON.parse((await acme.get()).body).state).toBe('taken_over');
    expect((await acme.post('/reconnect', {})).statusCode).toBe(409);
    expect((await acme.post('/reconnect', { confirm_takeover: true })).statusCode).toBe(200);

    // --- health check: revoked → needs token; reconnect refused with the stored-token message ---
    fake.bot(rotated).script({ webhookUrl: hook.url, getMe: 'unauthorized' });
    clock.advance(4 * MINUTE);
    await tick();
    expect(JSON.parse((await acme.get()).body).state).toBe('needs_token');
    expect((await acme.post('/reconnect', {})).statusCode).toBe(409);

    // --- disconnect: Telegram down, then done; a late delivery ---
    const fresh = newToken(botId);
    fake.bot(fresh).script({ webhookUrl: hook.url });
    expect((await acme.post('/token', { token: fresh })).statusCode).toBe(200);
    fake.bot(fresh).script({ webhookUrl: hook.url, getWebhookInfo: 'fail' });
    expect((await acme.post('/disconnect')).statusCode).toBe(503);
    fake.bot(fresh).script({ webhookUrl: hook.url, deleteWebhook: 'fail' });
    expect((await acme.post('/disconnect')).statusCode).toBe(503);
    fake.bot(fresh).script({ webhookUrl: hook.url });
    expect((await acme.post('/disconnect')).statusCode).toBe(200);
    expect(
      (
        await deliver(
          hook,
          telegramUpdate({
            ...from,
            updateId: nextUpdate++,
            messageId: 4,
            date: t + 600,
            text: say('After disconnect'),
          }),
        )
      ).statusCode,
    ).toBe(401);
    expect((await acme.post('/disconnect')).statusCode).toBe(409);

    // --- the assertions ---
    const secrets = fake
      .calls()
      .filter((c) => c.method === 'setWebhook')
      .map((c) => String(c.params.secret_token));
    expect(secrets.length).toBeGreaterThan(0);
    const forbidden = [
      ...tokens,
      ...tokens.map((tk) => tk.slice(tk.indexOf(':') + 1)),
      ...tokens.map((tk) => `/bot${tk}`),
      ...new Set(secrets),
      'forged-secret-0001',
      ...texts,
    ];
    const log = lines.join('\n');
    expect(lines.length).toBeGreaterThan(20);
    for (const value of forbidden) {
      expect(log.includes(value), `log contains ${value.slice(0, 12)}…`).toBe(false);
      for (const body of bodies) {
        expect(body.includes(value), `a response body contains ${value.slice(0, 12)}…`).toBe(false);
      }
    }
    // Telegram failures answer the contract's envelope — no Bot API URL, host or Telegram text.
    const apiHost = new URL(fake.apiRoot).host;
    for (const body of bodies) {
      expect(body).not.toContain(apiHost);
      expect(body).not.toContain('api.telegram.org');
      expect(body).not.toMatch(/Bad Request|Unauthorized|Too Many Requests|Internal Server Error/);
    }
    expect(log).not.toContain(apiHost);
  });

  it('inbox responses, media, socket frames and logs carry no bot token or file URL (inbox extension)', async () => {
    const acme = await owner();
    const botId = nextBot++;
    const token = newToken(botId);
    fake.bot(token).script({
      files: { 'file-p-m': { path: 'photos/secret-path.jpg', size: 4096 } },
      sendMessage: [sendAnswers.ok(501), sendAnswers.blocked()],
    });
    expect((await acme.post('/token', { token })).statusCode).toBe(200);
    const hook = webhookOf(token);
    const inbox = `/api/workspaces/${acme.workspaceId}/inbox`;
    const { cookies } = acme;
    const seen: string[] = [];
    const read = async (url: string) => {
      const res = await app.inject({ method: 'GET', url, cookies });
      expect(res.statusCode, url).toBe(200);
      bodies.push(res.body, JSON.stringify(res.headers));
      seen.push(res.body, JSON.stringify(res.headers));
      return res;
    };
    const send = async (url: string, payload: object) => {
      const res = await app.inject({ method: 'POST', url, cookies, payload });
      bodies.push(res.body, JSON.stringify(res.headers));
      seen.push(res.body, JSON.stringify(res.headers));
      return res;
    };

    // A live socket for the whole story: every frame is kept.
    await app.ready();
    const frames: string[] = [];
    const socket = await app.injectWS(`${inbox}/live`, {
      headers: { cookie: `session=${cookies.session}`, origin: 'http://localhost:5173' },
    });
    socket.on('message', (data: Buffer) => frames.push(String(data)));

    clock.advance(MINUTE);
    const t = Math.floor(clock.now().getTime() / 1000);
    const from = { fromId: 940777 };
    await deliver(
      hook,
      telegramUpdate({
        ...from,
        updateId: nextUpdate++,
        messageId: 1,
        date: t,
        text: say('Inbox probe text'),
      }),
    );
    await deliver(
      hook,
      telegramUpdate({
        ...from,
        updateId: nextUpdate++,
        messageId: 2,
        date: t,
        kind: 'photo',
        caption: say('Inbox probe photo'),
      }),
    );

    const page = JSON.parse((await read(inbox + '/conversations')).body);
    const conv = page.items[0].id as string;
    await read(`${inbox}/conversations/${conv}`);
    const items = JSON.parse((await read(`${inbox}/conversations/${conv}/items`)).body).items;
    const photo = items.find((i: { kind?: string }) => i.kind === 'photo');
    expect(photo).toBeDefined();
    await read(`${inbox}/bot`);

    // Media: headers and body, whole and ranged; no redirect to a file URL.
    const mediaUrl = `${inbox}/conversations/${conv}/messages/${photo.id}/media`;
    const media = await app.inject({ method: 'GET', url: mediaUrl, cookies });
    expect(media.statusCode).toBe(200);
    expect(media.headers.location).toBeUndefined();
    expect(media.rawPayload.length).toBe(4096);
    seen.push(media.rawPayload.toString('latin1'), JSON.stringify(media.headers));
    const ranged = await app.inject({
      method: 'GET',
      url: mediaUrl,
      cookies,
      headers: { range: 'bytes=0-99' },
    });
    expect(ranged.statusCode).toBe(206);
    seen.push(ranged.rawPayload.toString('latin1'), JSON.stringify(ranged.headers));
    // A gone file answers a typed refusal that does not echo Telegram.
    fake.bot(token).script({ files: { 'file-p-m': 'not_found' } });
    const gone = await app.inject({ method: 'GET', url: mediaUrl, cookies });
    seen.push(gone.body, JSON.stringify(gone.headers));
    expect(gone.statusCode).toBeGreaterThanOrEqual(400);

    // Replies: sent, then refused by Telegram (blocked); a reply may quote another bot's token.
    fake.bot(token).script({
      files: { 'file-p-m': { path: 'photos/secret-path.jpg', size: 4096 } },
      sendMessage: [sendAnswers.ok(501), sendAnswers.blocked()],
    });
    const otherBot = fakeBotToken(777000n);
    const replyTexts = [say('Reply one\nline two'), say(`Use this: ${otherBot}`)];
    for (const text of replyTexts) {
      const res = await send(`${inbox}/conversations/${conv}/replies`, {
        client_key: newId(),
        body: text,
        last_seen_reply_id: null,
      });
      expect(res.statusCode).toBe(201);
      const id = JSON.parse(res.body).id as string;
      await vi.waitFor(
        async () => {
          const row = await deps.db
            .selectFrom('replies')
            .select('state')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          expect(row.state).not.toBe('sending');
        },
        { timeout: 10_000, interval: 100 },
      );
    }
    await read(`${inbox}/conversations/${conv}/items`);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 5000 });
    socket.terminate();

    // --- the assertions: this bot's token (and secret part), the webhook secret, any file URL ---
    const forbidden = [
      token,
      token.slice(token.indexOf(':') + 1),
      `/bot${token}`,
      hook.secret,
      'api.telegram.org/file',
      '/file/bot',
      'secret-path.jpg',
      new URL(fake.apiRoot).host,
    ];
    const everything = [...seen, ...frames];
    expect(seen.length).toBeGreaterThan(8);
    const log = lines.join('\n');
    for (const value of forbidden) {
      for (const chunk of everything) {
        expect(
          chunk.includes(value),
          `an inbox response/frame contains ${value.slice(0, 12)}…`,
        ).toBe(false);
      }
      expect(log.includes(value), `the log contains ${value.slice(0, 12)}…`).toBe(false);
    }
    // Message and reply texts stay out of the logs as well.
    for (const text of [...texts.slice(-4), ...replyTexts]) {
      expect(log.includes(text), `the log contains a message text`).toBe(false);
    }
  }, 60_000);

  it('assignment and status responses, activity frames and change logs carry no bot token, display name or message text (assignment-statuses extension)', async () => {
    const acme = await owner();
    const botId = nextBot++;
    const token = newToken(botId);
    fake.bot(token).script({});
    expect((await acme.post('/token', { token })).statusCode).toBe(200);
    const hook = webhookOf(token);
    const inbox = `/api/workspaces/${acme.workspaceId}/inbox`;
    const { cookies } = acme;
    const NAME = 'Zelda Zebrapatch';
    const mate = await insertAccount(deps.db, { displayName: NAME });
    await insertMembership(deps.db, acme.workspaceId, { accountId: mate.id });
    const mateMembership = await deps.db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', acme.workspaceId)
      .where('account_id', '=', mate.id)
      .executeTakeFirstOrThrow();

    const seen: string[] = [];
    const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
      const res = await app.inject({ method, url, cookies, ...(payload && { payload }) });
      expect(res.statusCode, url).toBe(200);
      seen.push(res.body, JSON.stringify(res.headers));
      return JSON.parse(res.body);
    };
    await app.ready();
    const frames: string[] = [];
    const socket = await app.injectWS(`${inbox}/live`, {
      headers: { cookie: `session=${cookies.session}`, origin: 'http://localhost:5173' },
    });
    socket.on('message', (data: Buffer) => frames.push(String(data)));

    clock.advance(MINUTE);
    const t = Math.floor(clock.now().getTime() / 1000);
    const customerText = say('Assignment probe text');
    await deliver(
      hook,
      telegramUpdate({
        fromId: 940888,
        updateId: nextUpdate++,
        messageId: 1,
        date: t,
        text: customerText,
      }),
    );
    const conv = (await call('GET', `${inbox}/conversations`)).items[0].id as string;
    const url = `${inbox}/conversations/${conv}`;
    const state = async () => call('GET', url);
    await call('GET', `${inbox}/members`);

    await call('POST', `${url}/assign`, {
      assignee_account_id: mate.id,
      expected_state_version: (await state()).state_version,
    });
    await call('POST', `${url}/unassign`, {
      expected_state_version: (await state()).state_version,
    });
    await call('POST', `${url}/assign`, {
      assignee_account_id: mate.id,
      expected_state_version: (await state()).state_version,
    });
    const closeOnce = async () => {
      const s = await state();
      return call('POST', `${url}/close`, {
        expected_state_version: s.state_version,
        expected_close_snapshot: s.close_snapshot,
        confirm_close_reasons: true,
      });
    };
    await closeOnce();
    // The customer writes again: an automatic reopen with its own activity entry and frame.
    await deliver(
      hook,
      telegramUpdate({
        fromId: 940888,
        updateId: nextUpdate++,
        messageId: 2,
        date: t + 1,
        text: say('Assignment probe again'),
      }),
    );
    await closeOnce();
    await call('POST', `${url}/reopen`, {
      expected_state_version: (await state()).state_version,
    });
    const thread = await call('GET', `${url}/items`);
    const activities = thread.items.filter((i: { type: string }) => i.type === 'activity');
    expect(activities.length).toBeGreaterThanOrEqual(6);
    for (const a of activities) await call('GET', `${url}/activities/${a.id}`);
    // Deactivation unassigns by itself: one more activity entry and frame.
    await call(
      'POST',
      `/api/workspaces/${acme.workspaceId}/memberships/${mateMembership.id}/deactivate`,
    );
    await call('GET', `${inbox}/conversations?assignee=unassigned`);
    await vi.waitFor(
      () => expect(frames.filter((f) => f.includes('"activity"')).length).toBeGreaterThanOrEqual(8),
      { timeout: 5000 },
    );
    socket.terminate();

    // No token, token secret part, webhook secret or file URL in any body, header or frame.
    const forbidden = [
      token,
      token.slice(token.indexOf(':') + 1),
      `/bot${token}`,
      hook.secret,
      new URL(fake.apiRoot).host,
    ];
    const everything = [...seen, ...frames];
    expect(seen.length).toBeGreaterThan(20);
    const log = lines.join('\n');
    for (const value of forbidden) {
      for (const chunk of everything) {
        expect(chunk.includes(value), `a response/frame contains ${value.slice(0, 12)}…`).toBe(
          false,
        );
      }
      expect(log.includes(value), `the log contains ${value.slice(0, 12)}…`).toBe(false);
    }
    // Frames carry ids only: no display name, no message text.
    for (const frame of frames) {
      expect(frame).not.toContain(NAME);
      expect(frame).not.toContain(customerText);
    }
    // Change logs carry ids, kind, cause and outcome: no display name and no message text.
    const changeLogs = lines.filter((l) => l.includes('"conversation change"'));
    expect(changeLogs.length).toBeGreaterThanOrEqual(6);
    for (const line of changeLogs) {
      const entry = JSON.parse(line);
      expect(entry).toMatchObject({
        workspaceId: acme.workspaceId,
        conversationId: conv,
        outcome: expect.stringMatching(/^(recorded|unchanged)$/),
      });
      expect(entry).toHaveProperty('activityId');
      expect(entry).toHaveProperty('kind');
      expect(entry).toHaveProperty('cause');
    }
    for (const value of [NAME, 'Test User', ...texts.slice(-2)]) {
      for (const line of changeLogs) expect(line).not.toContain(value);
      expect(log.includes(value), `the log contains ${value}`).toBe(false);
    }
  }, 60_000);

  it('the request log of a webhook delivery carries no secret header; a logged header bag is redacted', () => {
    const webhookRequests = lines.filter(
      (l) => l.includes('incoming request') && l.includes('/api/telegram/webhook/'),
    );
    expect(webhookRequests.length).toBeGreaterThan(0);
    for (const line of webhookRequests) {
      expect(line).not.toMatch(/x-telegram-bot-api-secret-token/i);
    }
    const before = lines.length;
    app.log.info(
      { headers: { 'x-telegram-bot-api-secret-token': 'header-secret-0002' } },
      'header probe',
    );
    const probe = lines.slice(before).join('\n');
    expect(probe).toContain('[Redacted]');
    expect(probe).not.toContain('header-secret-0002');
  });

  it('the shared bot schemas have no token or secret field in any response', () => {
    /** Every property name anywhere in a JSON Schema. */
    const keysOf = (node: unknown): string[] => {
      if (Array.isArray(node)) return node.flatMap(keysOf);
      if (!node || typeof node !== 'object') return [];
      const record = node as Record<string, unknown>;
      const own = record.properties ? Object.keys(record.properties as object) : [];
      return [...own, ...Object.values(record).flatMap(keysOf)];
    };
    for (const schema of [
      BotSettings,
      BotIdentity,
      TakeoverConfirmationDetails,
      SettingsRefusalDetails,
    ]) {
      const keys = keysOf(z.toJSONSchema(schema));
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((k) => /token|secret/i.test(k))).toEqual([]);
    }
    // Requests may carry the token — the paste, and only the paste.
    expect(keysOf(z.toJSONSchema(BotTokenPaste))).toContain('token');
    expect(keysOf(z.toJSONSchema(BotReconnect))).toEqual(['confirm_takeover']);
  });
});
