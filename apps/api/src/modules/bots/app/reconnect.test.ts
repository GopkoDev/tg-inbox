import { describe, expect, it } from 'vitest';
import {
  BotNeedsNewTokenError,
  NothingToReconnectError,
  TakeoverConfirmationRequiredError,
  TelegramUnavailableError,
} from '../../../platform/errors.js';
import { at, BASE_URL, botRow, createBotsHarness } from './harness.js';
import { OWNER_ACTION_TIMEOUT } from './ports.js';

const takenOver = botRow({ state: 'taken_over' });
const ME = { ok: true as const, telegramBotId: 100001n, name: 'Acme Bot', username: 'acme_bot' };

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as Error & { details?: unknown };
  }
  throw new Error('expected a refusal');
}

describe('reconnect (flow 6, AC-16b)', () => {
  it.each(['connected', 'needs_token'] as const)(
    'while %s → NOTHING_TO_RECONNECT with the current settings, no Telegram call',
    async (state) => {
      const h = createBotsHarness([botRow({ state })]);
      const err = await refusal(h.reconnect.reconnect('ws-a', false));
      expect(err).toBeInstanceOf(NothingToReconnectError);
      expect(err.details).toEqual({ settings: await h.settings.getSettings('ws-a') });
      expect(h.telegram.calls).toHaveLength(0);
    },
  );

  it('no bot, or a disconnected one → NOTHING_TO_RECONNECT with not_connected', async () => {
    const h = createBotsHarness([
      botRow({ state: 'disconnected', token: null, webhookSecret: null, connectedAt: null }),
    ]);
    const err = await refusal(h.reconnect.reconnect('ws-a', false));
    expect(err.details).toEqual({ settings: { state: 'not_connected' } });
    expect(await refusal(createBotsHarness().reconnect.reconnect('ws-a', false))).toBeInstanceOf(
      NothingToReconnectError,
    );
  });

  it('stored token rejected → needs_token written at once, BOT_NEEDS_NEW_TOKEN with settings (AC-15)', async () => {
    const h = createBotsHarness([takenOver]);
    h.telegram.me = 'unauthorized';
    const err = await refusal(h.reconnect.reconnect('ws-a', true));
    expect(err).toBeInstanceOf(BotNeedsNewTokenError);
    expect(h.bots.rows[0]).toMatchObject({ state: 'needs_token', lastCheckedAt: at(600) });
    expect(err.details).toEqual({
      settings: expect.objectContaining({ state: 'needs_token' }) as unknown,
    });
  });

  it('getWebhookInfo rejects the token → needs_token too', async () => {
    const h = createBotsHarness([takenOver]);
    h.telegram.webhook = 'unauthorized';
    expect(await refusal(h.reconnect.reconnect('ws-a', true))).toBeInstanceOf(
      BotNeedsNewTokenError,
    );
    expect(h.bots.rows[0]!.state).toBe('needs_token');
  });

  it.each(['getMe', 'getWebhook'] as const)(
    '%s transient → TELEGRAM_UNAVAILABLE, nothing changed',
    async (call) => {
      const h = createBotsHarness([takenOver]);
      if (call === 'getMe') h.telegram.me = 'transient';
      else h.telegram.webhook = 'transient';
      expect(await refusal(h.reconnect.reconnect('ws-a', true))).toBeInstanceOf(
        TelegramUnavailableError,
      );
      expect(h.bots.rows).toEqual([takenOver]);
    },
  );

  it('another service and no confirmation → TAKEOVER_CONFIRMATION_REQUIRED, nothing changed (AC-06)', async () => {
    const h = createBotsHarness([takenOver]);
    h.telegram.me = ME;
    h.telegram.webhook = 'foreign';
    const err = await refusal(h.reconnect.reconnect('ws-a', false));
    expect(err).toBeInstanceOf(TakeoverConfirmationRequiredError);
    expect(err.details).toEqual({ bot: { name: 'Acme Bot', username: 'acme_bot' } });
    expect(h.bots.rows).toEqual([takenOver]);
    expect(h.telegram.calls.map((c) => c.method)).toEqual(['getMe', 'getWebhook']);
  });

  it.each([
    ['confirmed over another service', 'foreign', true],
    ['already ours', 'ours', false],
    ['no webhook', 'none', false],
  ] as const)('%s → setWebhook keeping pending updates, connected', async (_c, target, confirm) => {
    const h = createBotsHarness([takenOver]);
    h.telegram.me = ME;
    h.telegram.webhook = target;
    const settings = await h.reconnect.reconnect('ws-a', confirm);
    expect(settings).toMatchObject({ state: 'connected', bot: { name: 'Acme Bot' } });
    expect(h.bots.rows[0]).toMatchObject({
      state: 'connected',
      name: 'Acme Bot',
      username: 'acme_bot',
      lastCheckedAt: at(600),
      connectedAt: at(0),
      token: takenOver.token,
      webhookSecret: 'stored-secret',
    });
    expect(h.telegram.calls.at(-1)).toEqual({
      method: 'setWebhook',
      token: takenOver.token,
      timeoutMs: OWNER_ACTION_TIMEOUT,
      webhook: {
        url: `${BASE_URL}/api/telegram/webhook/${takenOver.id}`,
        secret: h.secrets.secretFor(takenOver.id, at(0)),
        dropPending: false,
      },
    });
  });

  it('setWebhook fails → TELEGRAM_UNAVAILABLE, state stays taken over', async () => {
    const h = createBotsHarness([takenOver]);
    h.telegram.setResult = 'failed';
    expect(await refusal(h.reconnect.reconnect('ws-a', true))).toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(h.bots.rows).toEqual([takenOver]);
  });

  it("another workspace's bot is not reachable", async () => {
    const h = createBotsHarness([botRow({ state: 'taken_over', workspaceId: 'ws-b' })]);
    expect(await refusal(h.reconnect.reconnect('ws-a', true))).toBeInstanceOf(
      NothingToReconnectError,
    );
    expect(h.telegram.calls).toHaveLength(0);
  });
});
