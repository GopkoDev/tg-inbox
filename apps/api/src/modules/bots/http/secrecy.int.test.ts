import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { fixedClock } from '../../../platform/clock.js';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { fakeBotToken } from '../../../test/fixtures/bots.js';
import { signedDelivery, telegramEdit, telegramUpdate } from '../../../test/fixtures/telegram.js';
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
