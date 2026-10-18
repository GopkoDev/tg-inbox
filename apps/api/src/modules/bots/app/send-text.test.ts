import { describe, expect, expectTypeOf, it } from 'vitest';
import type { GatewayOutcome } from '../../inbox/domain/delivery.js';
import { botRow, createBotsHarness } from './harness.js';
import { createMarkNeedsToken } from './mark-needs-token.js';
import { createSendText } from './send-text.js';
import { SEND_TIMEOUT, type SendOutcome } from './ports.js';

function setup(rows = [botRow()]) {
  const h = createBotsHarness(rows);
  const markNeedsToken = createMarkNeedsToken(h);
  const sendText = createSendText({ ...h, markNeedsToken });
  return { h, sendText, markNeedsToken };
}
const req = { workspaceId: 'ws-a', chatId: 700001n, text: 'Hi\nthere' };
const sendCalls = (h: ReturnType<typeof setup>['h']) =>
  h.telegram.calls.filter((c) => c.method === 'sendText');

describe('bots SendOutcome vs inbox GatewayOutcome', () => {
  it('are mutually assignable', () => {
    expectTypeOf<SendOutcome>().toEqualTypeOf<GatewayOutcome>();
  });
});

describe('sendText', () => {
  it('sends with the decrypted token, chat, text and the send timeout; returns the outcome', async () => {
    const { h, sendText } = setup();
    const accepted = { outcome: 'accepted', messageId: 5n, at: new Date() } as const;
    h.telegram.sendResult = accepted;
    expect(await sendText.sendText(req)).toEqual(accepted);
    expect(sendCalls(h)).toEqual([
      {
        method: 'sendText',
        token: h.bots.rows[0]!.token,
        timeoutMs: SEND_TIMEOUT,
        chatId: 700001n,
        text: 'Hi\nthere',
      },
    ]);
  });

  it.each(['needs_token', 'disconnected'] as const)(
    'a %s bot is not called: bot_unauthorized',
    async (state) => {
      const { h, sendText } = setup([
        botRow(
          state === 'disconnected'
            ? { state, token: null, webhookSecret: null, connectedAt: null }
            : { state },
        ),
      ]);
      expect(await sendText.sendText(req)).toEqual({ outcome: 'bot_unauthorized' });
      expect(sendCalls(h)).toHaveLength(0);
    },
  );

  it('no bot: bot_unauthorized, not called', async () => {
    const { h, sendText } = setup([]);
    expect(await sendText.sendText(req)).toEqual({ outcome: 'bot_unauthorized' });
    expect(sendCalls(h)).toHaveLength(0);
  });

  it('a taken_over bot still sends', async () => {
    const { h, sendText } = setup([botRow({ state: 'taken_over' })]);
    h.telegram.sendResult = { outcome: 'unknown' };
    expect(await sendText.sendText(req)).toEqual({ outcome: 'unknown' });
    expect(sendCalls(h)).toHaveLength(1);
  });

  it("another workspace's bot is never used", async () => {
    const { h, sendText } = setup([botRow({ workspaceId: 'ws-b' })]);
    expect(await sendText.sendText(req)).toEqual({ outcome: 'bot_unauthorized' });
    expect(sendCalls(h)).toHaveLength(0);
  });

  it('a 401 flips the bot to needs_token and publishes bot.changed once', async () => {
    const { h, sendText } = setup();
    h.telegram.sendResult = { outcome: 'bot_unauthorized' };
    expect(await sendText.sendText(req)).toEqual({ outcome: 'bot_unauthorized' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(h.signals.published).toEqual(['ws-a']);
  });

  it('an undecryptable token flips to needs_token without calling Telegram', async () => {
    const { h, sendText } = setup([botRow({ undecryptable: true })]);
    expect(await sendText.sendText(req)).toEqual({ outcome: 'bot_unauthorized' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(h.signals.published).toEqual(['ws-a']);
    expect(sendCalls(h)).toHaveLength(0);
  });

  it.each([
    { outcome: 'refused', reason: 'blocked' },
    { outcome: 'not_accepted', retryAfterMs: 1000 },
    { outcome: 'unknown' },
  ] as const)('%j leaves the bot and publishes nothing', async (outcome) => {
    const { h, sendText } = setup();
    h.telegram.sendResult = outcome;
    expect(await sendText.sendText(req)).toEqual(outcome);
    expect(h.bots.rows[0]!.state).toBe('connected');
    expect(h.signals.published).toEqual([]);
  });
});

describe('markNeedsToken', () => {
  it('is idempotent: already needs_token publishes nothing', async () => {
    const { h, markNeedsToken } = setup([botRow({ state: 'needs_token' })]);
    await markNeedsToken('ws-a');
    expect(h.signals.published).toEqual([]);
  });

  it('does nothing for a disconnected or missing bot', async () => {
    const { h, markNeedsToken } = setup([]);
    await markNeedsToken('ws-a');
    expect(h.signals.published).toEqual([]);
  });
});
