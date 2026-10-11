import { describe, expect, it } from 'vitest';
import { NoBotConnectedError, TelegramUnavailableError } from '../../../platform/errors.js';
import { botRow, createBotsHarness } from './harness.js';
import { OWNER_ACTION_TIMEOUT } from './ports.js';

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as Error & { details?: unknown };
  }
  throw new Error('expected a refusal');
}

describe('disconnect (flow 7, AC-18)', () => {
  it('no bot → NO_BOT_CONNECTED with not_connected', async () => {
    const h = createBotsHarness();
    const err = await refusal(h.disconnect.disconnect('ws-a'));
    expect(err).toBeInstanceOf(NoBotConnectedError);
    expect(err.details).toEqual({ settings: { state: 'not_connected' } });
  });

  it('already disconnected → NO_BOT_CONNECTED, no Telegram call', async () => {
    const h = createBotsHarness([
      botRow({ state: 'disconnected', token: null, webhookSecret: null, connectedAt: null }),
    ]);
    expect(await refusal(h.disconnect.disconnect('ws-a'))).toBeInstanceOf(NoBotConnectedError);
    expect(h.telegram.calls).toHaveLength(0);
  });

  it.each(['connected', 'needs_token', 'taken_over'] as const)(
    '%s, our webhook, conversations exist → deleteWebhook, row kept bound without token or secret',
    async (state) => {
      const h = createBotsHarness([botRow({ state })]);
      h.conversations.withConversations.add('ws-a');
      expect(await h.disconnect.disconnect('ws-a')).toEqual({ state: 'not_connected' });
      expect(h.telegram.calls.map((c) => [c.method, c.timeoutMs])).toEqual([
        ['getWebhook', OWNER_ACTION_TIMEOUT],
        ['deleteWebhook', OWNER_ACTION_TIMEOUT],
      ]);
      expect(h.bots.rows).toHaveLength(1);
      expect(h.bots.rows[0]).toMatchObject({
        state: 'disconnected',
        token: null,
        webhookSecret: null,
        connectedAt: null,
        telegramBotId: 100001n,
      });
    },
  );

  it('nothing captured → the row is deleted', async () => {
    const h = createBotsHarness([botRow()]);
    expect(await h.disconnect.disconnect('ws-a')).toEqual({ state: 'not_connected' });
    expect(h.bots.rows).toHaveLength(0);
  });

  it.each(['foreign', 'none'] as const)(
    'webhook %s → never deleteWebhook, disconnect proceeds',
    async (target) => {
      const h = createBotsHarness([botRow()]);
      h.telegram.webhook = target;
      await h.disconnect.disconnect('ws-a');
      expect(h.telegram.calls.map((c) => c.method)).toEqual(['getWebhook']);
      expect(h.bots.rows).toHaveLength(0);
    },
  );

  it('token rejected → the token is dead, disconnect proceeds without deleteWebhook', async () => {
    const h = createBotsHarness([botRow()]);
    h.telegram.webhook = 'unauthorized';
    expect(await h.disconnect.disconnect('ws-a')).toEqual({ state: 'not_connected' });
    expect(h.telegram.calls.map((c) => c.method)).toEqual(['getWebhook']);
    expect(h.bots.rows).toHaveLength(0);
  });

  it('getWebhookInfo transient → TELEGRAM_UNAVAILABLE, nothing changed', async () => {
    const h = createBotsHarness([botRow()]);
    h.telegram.webhook = 'transient';
    expect(await refusal(h.disconnect.disconnect('ws-a'))).toBeInstanceOf(TelegramUnavailableError);
    expect(h.bots.rows).toEqual([botRow()]);
  });

  it('deleteWebhook fails → TELEGRAM_UNAVAILABLE, nothing changed', async () => {
    const h = createBotsHarness([botRow()]);
    h.telegram.deleteResult = 'failed';
    expect(await refusal(h.disconnect.disconnect('ws-a'))).toBeInstanceOf(TelegramUnavailableError);
    expect(h.bots.rows).toEqual([botRow()]);
  });

  it("another workspace's bot is untouched", async () => {
    const h = createBotsHarness([botRow({ workspaceId: 'ws-b' })]);
    expect(await refusal(h.disconnect.disconnect('ws-a'))).toBeInstanceOf(NoBotConnectedError);
    expect(h.bots.rows).toHaveLength(1);
    expect(h.telegram.calls).toHaveLength(0);
  });
});
