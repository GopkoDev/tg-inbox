import { describe, expect, it } from 'vitest';
import { botRow, createBotsHarness, at } from './harness.js';
import { createMarkNeedsToken } from './mark-needs-token.js';
import { createPacer } from './pacer.js';
import { SEND_TIMEOUT, type SendOutcome } from './ports.js';
import { createSendMemberMessage } from './send-member-message.js';

function setup(rows = [botRow()]) {
  const h = createBotsHarness(rows);
  const markNeedsToken = createMarkNeedsToken(h);
  const paced: string[] = [];
  const pacer = {
    wait: async (key: string) => {
      paced.push(key);
    },
  };
  const send = createSendMemberMessage({ ...h, markNeedsToken, pacer });
  return { h, send, paced };
}
const req = { workspaceId: 'ws-a', telegramUserId: 5001n, text: 'Acme: 1 customer is waiting' };
const calls = (h: ReturnType<typeof setup>['h']) =>
  h.telegram.calls.filter((c) => c.method === 'sendText');

describe('sendMemberMessage', () => {
  it('sends to the member private chat with the decrypted token, the send timeout and no link preview', async () => {
    const { h, send, paced } = setup();
    h.telegram.sendResult = { outcome: 'accepted', messageId: 5n, at: new Date() };
    expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'accepted' });
    expect(calls(h)).toEqual([
      {
        method: 'sendText',
        token: h.bots.rows[0]!.token,
        timeoutMs: SEND_TIMEOUT,
        chatId: 5001n,
        text: req.text,
        options: { disableLinkPreview: true },
      },
    ]);
    expect(paced).toEqual([h.bots.rows[0]!.id]);
  });

  it('a taken_over bot still sends', async () => {
    const { h, send } = setup([botRow({ state: 'taken_over' })]);
    expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'accepted' });
    expect(calls(h)).toHaveLength(1);
  });

  it.each(['needs_token', 'disconnected'] as const)(
    'a %s bot is bot_unavailable and not called',
    async (state) => {
      const { h, send } = setup([
        botRow(
          state === 'disconnected'
            ? { state, token: null, webhookSecret: null, connectedAt: null }
            : { state },
        ),
      ]);
      expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'bot_unavailable' });
      expect(calls(h)).toHaveLength(0);
    },
  );

  it('no bot, or another workspace bot: bot_unavailable, not called', async () => {
    const none = setup([]);
    expect(await none.send.sendMemberMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    const other = setup([botRow({ workspaceId: 'ws-b' })]);
    expect(await other.send.sendMemberMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(calls(none.h)).toHaveLength(0);
    expect(calls(other.h)).toHaveLength(0);
  });

  it('refuses while the send pause is in the future, without calling or pacing', async () => {
    const until = at(900);
    const { h, send, paced } = setup([botRow({ sendPausedUntil: until })]);
    expect(await send.sendMemberMessage(req)).toEqual({
      outcome: 'rate_limited',
      retryAfter: until,
    });
    expect(calls(h)).toHaveLength(0);
    expect(paced).toEqual([]);
  });

  it('sends once the pause is over', async () => {
    const { h, send } = setup([botRow({ sendPausedUntil: at(600) })]);
    expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'accepted' });
    expect(calls(h)).toHaveLength(1);
  });

  it('a 429 answer is rate_limited and stores the pause as now + retry_after', async () => {
    const { h, send } = setup();
    h.telegram.sendResult = { outcome: 'not_accepted', retryAfterMs: 7000 };
    const expected = new Date(h.clock.now().getTime() + 7000);
    expect(await send.sendMemberMessage(req)).toEqual({
      outcome: 'rate_limited',
      retryAfter: expected,
    });
    expect(h.bots.rows[0]!.sendPausedUntil).toEqual(expected);
  });

  it('a 429 keeps a later stored pause', async () => {
    const later = new Date(at(600).getTime() + 600_000);
    const { h, send } = setup([botRow({ sendPausedUntil: at(500) })]);
    h.telegram.sendResult = { outcome: 'not_accepted', retryAfterMs: 1000 };
    h.bots.rows[0]!.sendPausedUntil = at(500);
    await send.sendMemberMessage(req);
    expect(h.bots.rows[0]!.sendPausedUntil).toEqual(new Date(h.clock.now().getTime() + 1000));
    h.bots.rows[0]!.sendPausedUntil = later;
    h.clock.set(new Date(later.getTime() + 1));
    h.bots.rows[0]!.sendPausedUntil = new Date(later.getTime() + 600_000);
    const stored = h.bots.rows[0]!.sendPausedUntil;
    expect(await send.sendMemberMessage(req)).toEqual({
      outcome: 'rate_limited',
      retryAfter: stored,
    });
  });

  it('a 403 (blocked, or a deactivated account) is blocked', async () => {
    for (const reason of ['blocked', 'account_gone', 'chat_not_found'] as const) {
      const { h, send } = setup();
      h.telegram.sendResult = { outcome: 'refused', reason };
      expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'blocked' });
    }
  });

  it('a 401 flips the bot to needs_token and is bot_unavailable', async () => {
    const { h, send } = setup();
    h.telegram.sendResult = { outcome: 'bot_unauthorized' };
    expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(h.signals.published).toEqual(['ws-a']);
  });

  it('an undecryptable token flips to needs_token without calling Telegram', async () => {
    const { h, send } = setup([botRow({ undecryptable: true })]);
    expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(calls(h)).toHaveLength(0);
  });

  it.each([
    { outcome: 'unknown' },
    { outcome: 'not_accepted' },
  ] as const satisfies readonly SendOutcome[])('%j is transient', async (outcome) => {
    const { h, send } = setup();
    h.telegram.sendResult = outcome;
    expect(await send.sendMemberMessage(req)).toEqual({ outcome: 'transient' });
    expect(h.bots.rows[0]!.sendPausedUntil ?? null).toBeNull();
  });

  it('the real pacer is accepted as the pacer port', () => {
    const pacer = createPacer({ perSecond: 10 });
    expect(typeof pacer.wait).toBe('function');
  });
});
