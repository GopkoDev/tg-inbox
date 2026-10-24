import { describe, expect, it } from 'vitest';
import { at, botRow, createBotsHarness } from './harness.js';
import { createLaunchReadiness } from './launch-readiness.js';
import { createMarkNeedsToken } from './mark-needs-token.js';
import { BROADCAST_MESSAGES_PER_SECOND, createPacer } from './pacer.js';
import { SEND_TIMEOUT, type BroadcastSendAnswer } from './ports.js';
import { createSendBroadcastMessage } from './send-broadcast-message.js';
import type { FakeBotRow } from './fakes.js';

const TEXT = '  Spring prices *bold* <b>x</b>\nfrom Monday.';
const req = {
  workspaceId: 'ws-a',
  telegramBotId: 100001n,
  chatId: 700001n,
  text: TEXT,
  launchedAt: at(0),
};

function setup(rows: FakeBotRow[] = [botRow()]) {
  const h = createBotsHarness(rows);
  const waits: string[] = [];
  const pacer = { wait: async (key: string) => void waits.push(key) };
  const markNeedsToken = createMarkNeedsToken(h);
  const send = createSendBroadcastMessage({ ...h, markNeedsToken, pacer });
  return { h, send, waits };
}
const telegramCalls = (h: ReturnType<typeof createBotsHarness>) =>
  h.telegram.calls.filter((c) => c.method === 'sendBroadcast');

describe('sendBroadcastMessage — the send (AC-08, AC-17)', () => {
  it('sends the exact text to the chat through the workspace bot, taking a pacer slot', async () => {
    const { h, send, waits } = setup();
    const at0 = new Date('2026-10-23T10:00:00Z');
    h.telegram.broadcastResult = { outcome: 'accepted', messageId: 77n, at: at0 };
    expect(await send.sendBroadcastMessage(req)).toEqual({
      outcome: 'delivered',
      messageId: 77n,
      at: at0,
    });
    expect(telegramCalls(h)).toEqual([
      {
        method: 'sendBroadcast',
        token: h.bots.rows[0]!.token,
        timeoutMs: SEND_TIMEOUT,
        chatId: 700001n,
        text: TEXT,
      },
    ]);
    expect(waits).toEqual([botRow().id]);
  });

  it('a taken-over bot still sends (the reply rule)', async () => {
    const { h, send } = setup([botRow({ state: 'taken_over' })]);
    expect((await send.sendBroadcastMessage(req)).outcome).toBe('delivered');
    expect(telegramCalls(h)).toHaveLength(1);
  });
});

describe('sendBroadcastMessage — refusals without a Telegram call (AC-10, AC-12, AC-15)', () => {
  it.each([
    ['no bot', [] as FakeBotRow[]],
    ['a needs_token bot', [botRow({ state: 'needs_token' })]],
    [
      'a disconnected bot',
      [botRow({ state: 'disconnected', token: null, webhookSecret: null, connectedAt: null })],
    ],
  ])('%s → bot_unavailable', async (_name, rows) => {
    const { h, send, waits } = setup(rows);
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(telegramCalls(h)).toHaveLength(0);
    expect(waits).toEqual([]);
  });

  it('a pause stored while the send waited for its pacer slot holds it: paused, no Telegram call', async () => {
    const h = createBotsHarness([botRow()]);
    // Another send of the bot gets a 429 while this one waits in the pacer.
    const pacer = {
      wait: async () => {
        h.bots.rows[0]!.sendPausedUntil = at(900);
      },
    };
    const send = createSendBroadcastMessage({
      ...h,
      markNeedsToken: createMarkNeedsToken(h),
      pacer,
    });
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'paused', until: at(900) });
    expect(telegramCalls(h)).toHaveLength(0);
  });

  it('AC-12: the same bot connected again after the launch (it stopped working meanwhile) → bot_unavailable', async () => {
    const { h, send } = setup([botRow({ connectedAt: at(300) })]);
    expect(await send.sendBroadcastMessage({ ...req, launchedAt: at(200) })).toEqual({
      outcome: 'bot_unavailable',
    });
    expect(telegramCalls(h)).toHaveLength(0);
    // Connected before the launch and working since: sent.
    expect((await send.sendBroadcastMessage({ ...req, launchedAt: at(400) })).outcome).toBe(
      'delivered',
    );
  });

  it('another Telegram bot than the launch one → bot_changed', async () => {
    const { h, send } = setup([botRow({ telegramBotId: 200002n })]);
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'bot_changed' });
    expect(telegramCalls(h)).toHaveLength(0);
  });

  it('the send pause ahead → paused until then; a past pause does not hold the send', async () => {
    const { h, send, waits } = setup([botRow({ sendPausedUntil: at(700) })]);
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'paused', until: at(700) });
    expect(telegramCalls(h)).toHaveLength(0);
    expect(waits).toEqual([]);
    h.bots.rows[0]!.sendPausedUntil = at(500); // the clock is at(600)
    expect((await send.sendBroadcastMessage(req)).outcome).toBe('delivered');
  });

  it('a workspace never sends through another workspace’s bot', async () => {
    const { h, send } = setup([botRow({ workspaceId: 'ws-b' })]);
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(telegramCalls(h)).toHaveLength(0);
  });

  it('an undecryptable token → bot_unavailable and needs_token', async () => {
    const { h, send } = setup([botRow({ undecryptable: true })]);
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(telegramCalls(h)).toHaveLength(0);
  });
});

describe('sendBroadcastMessage — every Telegram answer classified (AC-11, AC-12, AC-14, AC-15)', () => {
  it.each([
    [{ outcome: 'account_gone' }, { outcome: 'account_gone' }],
    [{ outcome: 'chat_not_found' }, { outcome: 'chat_not_found' }],
    [{ outcome: 'text_refused' }, { outcome: 'text_refused' }],
    [{ outcome: 'error' }, { outcome: 'telegram_error' }],
    [{ outcome: 'unknown' }, { outcome: 'not_confirmed' }],
  ] as [BroadcastSendAnswer, unknown][])('%o → %o', async (answer, expected) => {
    const { h, send } = setup();
    h.telegram.broadcastResult = answer;
    expect(await send.sendBroadcastMessage(req)).toEqual(expected);
    expect(h.reach.changes).toEqual([]);
  });

  it('blocked records the block for this bot at our clock', async () => {
    const { h, send } = setup();
    h.telegram.broadcastResult = { outcome: 'blocked' };
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'blocked' });
    expect(h.reach.changes).toEqual([
      {
        workspaceId: 'ws-a',
        telegramBotId: 100001n,
        telegramUserId: 700001n,
        blocked: true,
        at: h.clock.now(),
      },
    ]);
  });

  it('a failing block record still answers blocked', async () => {
    const { h, send } = setup();
    h.telegram.broadcastResult = { outcome: 'blocked' };
    h.reach.fail = true;
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'blocked' });
  });

  it('a 429 stores the send pause and answers rate_limited until then', async () => {
    const { h, send } = setup();
    h.telegram.broadcastResult = { outcome: 'rate_limited', retryAfterMs: 5000 };
    const until = new Date(h.clock.now().getTime() + 5000);
    expect(await send.sendBroadcastMessage(req)).toEqual({
      outcome: 'rate_limited',
      retryAfter: until,
    });
    expect(h.bots.rows[0]!.sendPausedUntil).toEqual(until);
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'paused', until });
    expect(telegramCalls(h)).toHaveLength(1);
  });

  it('a 429 without retry_after pauses for one second', async () => {
    const { h, send } = setup();
    h.telegram.broadcastResult = { outcome: 'rate_limited' };
    expect(await send.sendBroadcastMessage(req)).toEqual({
      outcome: 'rate_limited',
      retryAfter: new Date(h.clock.now().getTime() + 1000),
    });
  });

  it('a rejected token flips the bot to needs_token and answers bot_unavailable', async () => {
    const { h, send } = setup();
    h.telegram.broadcastResult = { outcome: 'bot_unauthorized' };
    expect(await send.sendBroadcastMessage(req)).toEqual({ outcome: 'bot_unavailable' });
    expect(h.bots.rows[0]!.state).toBe('needs_token');
    expect(h.signals.published).toEqual(['ws-a']);
  });

  it('no answer carries the text, the chat id or the token', async () => {
    const answers: BroadcastSendAnswer[] = [
      { outcome: 'accepted', messageId: 1n, at: new Date(0) },
      { outcome: 'blocked' },
      { outcome: 'text_refused' },
      { outcome: 'error' },
      { outcome: 'unknown' },
      { outcome: 'rate_limited', retryAfterMs: 1000 },
    ];
    for (const answer of answers) {
      const { h, send } = setup();
      h.telegram.broadcastResult = answer;
      const out = JSON.stringify(await send.sendBroadcastMessage(req), (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(out).not.toContain('Spring prices');
      expect(out).not.toContain('700001');
      expect(out).not.toContain(h.bots.rows[0]!.token!);
    }
  });
});

describe('launchReadiness (AC-10)', () => {
  it('answers the bot state and Telegram bot id, or null with no bot row', async () => {
    const h = createBotsHarness([botRow({ state: 'taken_over' })]);
    const reads = createLaunchReadiness(h);
    expect(await reads.launchReadiness('ws-a')).toEqual({
      state: 'taken_over',
      telegramBotId: 100001n,
    });
    expect(await reads.launchReadiness('ws-b')).toBeNull();
  });
});

describe('the broadcast pacer (ADR-0008)', () => {
  it('starts one bot’s sends at least 40 ms apart: no 1 s window holds more than 25', async () => {
    let t = 1_000_000;
    const pacer = createPacer({
      perSecond: BROADCAST_MESSAGES_PER_SECOND,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    const starts: number[] = [];
    for (let i = 0; i < 60; i++) {
      await pacer.wait('bot-a');
      starts.push(t);
    }
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(40);
    }
    for (const [i, s] of starts.entries()) {
      expect(starts.filter((x, j) => j >= i && x < s + 1000).length).toBeLessThanOrEqual(25);
    }
  });
});
