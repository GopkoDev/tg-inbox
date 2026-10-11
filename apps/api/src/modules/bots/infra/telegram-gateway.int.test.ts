import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeTelegram, type FakeTelegram } from '../../../test/fake-telegram.js';
import { HEALTH_CHECK_TIMEOUT, OWNER_ACTION_TIMEOUT } from '../app/ports.js';
import { createTelegramGateway } from './telegram-gateway.js';

const TOKEN = '100001:TEST-gateway-token-not-real-aaaaaaaaaaaa';
const OUR_URL =
  'https://tg-inbox.example.test/api/telegram/webhook/0199e000-0000-7000-8000-000000000001';
const SECRET = 'derived_secret_value_for_tests_only_000000';

describe('Telegram gateway (against the fake Bot API)', () => {
  let fake: FakeTelegram;
  let gateway: ReturnType<typeof createTelegramGateway>;
  const output: string[] = [];

  beforeAll(async () => {
    fake = await startFakeTelegram();
    gateway = createTelegramGateway({ apiRoot: fake.apiRoot, maxConnections: 7 });
  });

  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    fake.reset();
    output.length = 0;
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Nothing the gateway printed may carry the token or a Bot API URL.
    const printed = output.join('\n');
    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain('/bot');
  });

  it('exports the owner-action and health-check timeouts', () => {
    expect(OWNER_ACTION_TIMEOUT).toBe(1000);
    expect(HEALTH_CHECK_TIMEOUT).toBe(10_000);
  });

  describe('getMe', () => {
    it('returns the bot id, name and username', async () => {
      fake.bot(TOKEN).script({ me: { first_name: 'Test Bot 1', username: 'test_bot_1' } });
      expect(await gateway.getMe(TOKEN, OWNER_ACTION_TIMEOUT)).toEqual({
        ok: true,
        telegramBotId: 100001n,
        name: 'Test Bot 1',
        username: 'test_bot_1',
      });
    });

    it.each([
      ['a revoked token (401)', { getMe: 'unauthorized' as const }, 'unauthorized'],
      ['a server error (500)', { getMe: 'server_error' as const }, 'transient'],
      ['a rate limit (429)', { getMe: 'rate_limited' as const }, 'transient'],
    ])('maps %s', async (_name, script, outcome) => {
      fake.bot(TOKEN).script(script);
      expect(await gateway.getMe(TOKEN, OWNER_ACTION_TIMEOUT)).toBe(outcome);
    });

    it('maps an unknown token to unauthorized', async () => {
      expect(await gateway.getMe(TOKEN, OWNER_ACTION_TIMEOUT)).toBe('unauthorized');
    });

    it('times a hung call out at the given timeout as transient', async () => {
      fake.bot(TOKEN).script({ getMe: 'hang' });
      const started = Date.now();
      expect(await gateway.getMe(TOKEN, OWNER_ACTION_TIMEOUT)).toBe('transient');
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(2500);
    });

    it('maps an unreachable Bot API (network error) to transient', async () => {
      const offline = createTelegramGateway({ apiRoot: 'http://127.0.0.1:1', maxConnections: 7 });
      expect(await offline.getMe(TOKEN, OWNER_ACTION_TIMEOUT)).toBe('transient');
    });
  });

  describe('getWebhook', () => {
    it.each([
      ['no webhook', undefined, 'none'],
      ['ours', OUR_URL, 'ours'],
      ['ours with a trailing slash', `${OUR_URL}/`, 'ours'],
      ['another service', 'https://other-service.example.test/hook', 'foreign'],
      ['another bot id on our host', OUR_URL.replace(/1$/, '2'), 'foreign'],
    ])('reports %s', async (_name, webhookUrl, outcome) => {
      fake.bot(TOKEN).script({ webhookUrl });
      expect(await gateway.getWebhook(TOKEN, OUR_URL, OWNER_ACTION_TIMEOUT)).toBe(outcome);
    });

    it('maps a rejected token to unauthorized and a failure or hang to transient', async () => {
      expect(await gateway.getWebhook(TOKEN, OUR_URL, OWNER_ACTION_TIMEOUT)).toBe('unauthorized');
      fake.bot(TOKEN).script({ getWebhookInfo: 'fail' });
      expect(await gateway.getWebhook(TOKEN, OUR_URL, OWNER_ACTION_TIMEOUT)).toBe('transient');
      fake.bot(TOKEN).script({ getWebhookInfo: 'hang' });
      expect(await gateway.getWebhook(TOKEN, OUR_URL, OWNER_ACTION_TIMEOUT)).toBe('transient');
    });
  });

  describe('setWebhook', () => {
    it.each([true, false])(
      'registers our URL, secret, allowed updates, max connections and drop pending = %s',
      async (dropPending) => {
        fake.bot(TOKEN).script({});
        expect(
          await gateway.setWebhook(
            TOKEN,
            { url: OUR_URL, secret: SECRET, dropPending },
            OWNER_ACTION_TIMEOUT,
          ),
        ).toBe('ok');
        expect(fake.calls(TOKEN)).toEqual([
          {
            token: TOKEN,
            method: 'setWebhook',
            params: {
              url: OUR_URL,
              secret_token: SECRET,
              allowed_updates: ['message', 'edited_message'],
              max_connections: 7,
              drop_pending_updates: dropPending,
            },
          },
        ]);
      },
    );

    it.each([
      ['a failure', { setWebhook: 'fail' as const }],
      ['a hang', { setWebhook: 'hang' as const }],
      ['a rejected token', null],
    ])('returns failed on %s', async (_name, script) => {
      if (script) fake.bot(TOKEN).script(script);
      expect(
        await gateway.setWebhook(
          TOKEN,
          { url: OUR_URL, secret: SECRET, dropPending: true },
          OWNER_ACTION_TIMEOUT,
        ),
      ).toBe('failed');
    });
  });

  describe('deleteWebhook', () => {
    it('deletes, always dropping pending updates', async () => {
      fake.bot(TOKEN).script({ webhookUrl: OUR_URL });
      expect(await gateway.deleteWebhook(TOKEN, OWNER_ACTION_TIMEOUT)).toBe('ok');
      expect(fake.calls(TOKEN)[0]).toMatchObject({
        method: 'deleteWebhook',
        params: { drop_pending_updates: true },
      });
    });

    it.each([
      ['a failure', { deleteWebhook: 'fail' as const }],
      ['a hang', { deleteWebhook: 'hang' as const }],
    ])('returns failed on %s', async (_name, script) => {
      fake.bot(TOKEN).script(script);
      expect(await gateway.deleteWebhook(TOKEN, OWNER_ACTION_TIMEOUT)).toBe('failed');
    });
  });

  it('never throws, and no outcome carries the token or the API URL', async () => {
    fake.bot(TOKEN).script({
      getMe: 'server_error',
      getWebhookInfo: 'fail',
      setWebhook: 'fail',
      deleteWebhook: 'fail',
    });
    const outcomes = await Promise.all([
      gateway.getMe(TOKEN, OWNER_ACTION_TIMEOUT),
      gateway.getWebhook(TOKEN, OUR_URL, OWNER_ACTION_TIMEOUT),
      gateway.setWebhook(
        TOKEN,
        { url: OUR_URL, secret: SECRET, dropPending: false },
        OWNER_ACTION_TIMEOUT,
      ),
      gateway.deleteWebhook(TOKEN, OWNER_ACTION_TIMEOUT),
    ]);
    const serialised = JSON.stringify(outcomes, (_k, v: unknown) =>
      typeof v === 'bigint' ? String(v) : v,
    );
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(fake.apiRoot);
  });
});
