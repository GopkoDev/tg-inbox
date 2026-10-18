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

  it('already disconnected (kept for its conversations) → NO_BOT_CONNECTED, no Telegram call', async () => {
    const h = createBotsHarness([
      botRow({ state: 'disconnected', token: null, webhookSecret: null, connectedAt: null }),
    ]);
    h.conversations.withConversations.add('ws-a');
    expect(await refusal(h.disconnect.disconnect('ws-a'))).toBeInstanceOf(NoBotConnectedError);
    expect(h.telegram.calls).toHaveLength(0);
    expect(h.bots.rows).toHaveLength(1);
  });

  it('a disconnect cut short after its clear (no conversations) is finished by running it again', async () => {
    const h = createBotsHarness([botRow()]);
    const hasConversations = h.conversations.hasConversations;
    h.conversations.hasConversations = async () => {
      throw new Error('database unavailable');
    };
    await expect(h.disconnect.disconnect('ws-a')).rejects.toThrow('database unavailable');
    expect(h.bots.rows[0]).toMatchObject({ state: 'disconnected' });
    h.conversations.hasConversations = hasConversations;
    const calls = h.telegram.calls.length;
    expect(await h.disconnect.disconnect('ws-a')).toEqual({ state: 'not_connected' });
    expect(h.bots.rows).toHaveLength(0);
    expect(h.telegram.calls).toHaveLength(calls);
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

  it('a stored token that cannot be decrypted → disconnects without a Telegram call (ADR-0006)', async () => {
    const h = createBotsHarness([botRow({ undecryptable: true })]);
    h.conversations.withConversations.add('ws-a');
    expect(await h.disconnect.disconnect('ws-a')).toEqual({ state: 'not_connected' });
    expect(h.telegram.calls).toHaveLength(0);
    expect(h.bots.rows[0]).toMatchObject({ state: 'disconnected', token: null });
  });

  it('a first conversation committed during the disconnect keeps the row bound (ADR-0007)', async () => {
    const h = createBotsHarness([botRow()]);
    // A delivery that authenticated before deleteWebhook commits its conversation meanwhile.
    const deleteWebhook = h.telegram.deleteWebhook.bind(h.telegram);
    h.telegram.deleteWebhook = async (token, timeoutMs) => {
      const result = await deleteWebhook(token, timeoutMs);
      h.conversations.withConversations.add('ws-a');
      return result;
    };
    const hasConversations = h.conversations.hasConversations;
    let checkedAfterClear = false;
    h.conversations.hasConversations = async (w) => {
      checkedAfterClear = h.bots.rows[0]?.state === 'disconnected';
      return hasConversations(w);
    };
    await h.disconnect.disconnect('ws-a');
    expect(checkedAfterClear).toBe(true);
    expect(h.bots.rows).toHaveLength(1);
    expect(h.bots.rows[0]).toMatchObject({ state: 'disconnected', webhookSecret: null });
  });
});

describe('disconnect publishes bot.changed (AC-13)', () => {
  it.each([true, false])('once, whether the row is kept (%s) or deleted', async (kept) => {
    const h = createBotsHarness([botRow()]);
    if (kept) h.conversations.withConversations.add('ws-a');
    await h.disconnect.disconnect('ws-a');
    expect(h.signals.published).toEqual(['ws-a']);
  });

  it('a refused disconnect signals nothing', async () => {
    const h = createBotsHarness();
    await refusal(h.disconnect.disconnect('ws-a'));
    expect(h.signals.published).toEqual([]);
  });
});
