import { describe, expect, it } from 'vitest';
import { at, botRow, createBotsHarness } from './harness.js';
import { createMarkNeedsToken } from './mark-needs-token.js';
import { POST_MESSAGES_PER_SECOND, createPacer } from './pacer.js';
import { createSendPost } from './send-post.js';
import { createDeletePost } from './delete-post.js';
import { createPostReadiness } from './post-readiness.js';
import type { FakeBotRow } from './fakes.js';

const CHAT = '-1001234567890';
const req = {
  workspaceId: 'ws-a',
  telegramBotId: 100001n,
  chatId: CHAT,
  text: 'Hi <b>x</b>',
  silent: true,
};

/** A gateway stub for the post calls, recording each one. */
function postGateway() {
  const calls: unknown[][] = [];
  const g = {
    sendAnswer: { outcome: 'accepted', messageId: 55n, at: at(600) } as Record<string, unknown>,
    deleteAnswer: { outcome: 'deleted' } as Record<string, unknown>,
    calls,
    async sendPost(...args: unknown[]) {
      calls.push(['sendPost', ...args]);
      return g.sendAnswer;
    },
    async deletePost(...args: unknown[]) {
      calls.push(['deletePost', ...args]);
      return g.deleteAnswer;
    },
  };
  return g;
}

function setup(rows: FakeBotRow[] = [botRow()]) {
  const h = createBotsHarness(rows);
  const gw = postGateway();
  const waits: string[] = [];
  const pacer = { wait: async (key: string) => void waits.push(key) };
  const deps = {
    ...h,
    telegram: gw as never,
    pacer,
    markNeedsToken: createMarkNeedsToken(h),
  };
  return {
    h,
    gw,
    waits,
    send: createSendPost(deps),
    del: createDeletePost(deps),
    readiness: createPostReadiness(h),
  };
}

describe('post pacer (AC-17)', () => {
  it('is one post per second per bot', async () => {
    expect(POST_MESSAGES_PER_SECOND).toBe(1);
    let t = 0;
    const slept: number[] = [];
    const pacer = createPacer({
      perSecond: POST_MESSAGES_PER_SECOND,
      now: () => t,
      sleep: async (ms) => {
        slept.push(ms);
        t += ms;
      },
    });
    await pacer.wait('bot');
    await pacer.wait('bot');
    expect(slept).toEqual([1000]);
  });
});

describe('sendPost (AC-07)', () => {
  it('sends the exact text to the chat id as a string, silent flag passed, taking a pacer slot', async () => {
    const { gw, send, waits, h } = setup();
    expect(await send.sendPost(req)).toEqual({ outcome: 'sent', messageId: 55n, at: at(600) });
    const call = gw.calls[0]!;
    expect(call[0]).toBe('sendPost');
    expect(call).toContain(h.bots.rows[0]!.token);
    expect(call).toContain(CHAT);
    expect(call).toContain('Hi <b>x</b>');
    expect(call).toContain(true);
    expect(waits).toEqual([botRow().id]);
  });

  it.each([
    ['no bot', [] as FakeBotRow[], 'bot_unavailable'],
    ['a needs_token bot', [botRow({ state: 'needs_token' })], 'bot_unavailable'],
    [
      'another Telegram bot (replaced since the claim)',
      [botRow({ telegramBotId: 999n })],
      'bot_changed',
    ],
  ])('%s is refused before the call', async (_n, rows, outcome) => {
    const { gw, send, waits } = setup(rows);
    expect(await send.sendPost(req)).toEqual({ outcome });
    expect(gw.calls).toEqual([]);
    expect(waits).toEqual([]);
  });

  it("waits for the bot's send pause (AC-17)", async () => {
    const until = new Date(at(600).getTime() + 30_000);
    const { gw, send } = setup([botRow({ sendPausedUntil: until })]);
    expect(await send.sendPost(req)).toEqual({ outcome: 'paused', until });
    expect(gw.calls).toEqual([]);
  });
});

describe('sendPost — classified failures (AC-13, AC-17)', () => {
  it.each([['no_post_right'], ['chat_gone'], ['text_refused'], ['no_answer']])(
    '%s is returned as is',
    async (outcome) => {
      const { gw, send } = setup();
      gw.sendAnswer = { outcome };
      expect(await send.sendPost(req)).toEqual({ outcome });
    },
  );

  it('an unclassified failure is telegram_error', async () => {
    const { gw, send } = setup();
    gw.sendAnswer = { outcome: 'error' };
    expect(await send.sendPost(req)).toEqual({ outcome: 'telegram_error' });
  });

  it('a 429 is rate_limited{retryAfterMs} and leaves the bot send pause untouched', async () => {
    const { gw, send, h } = setup();
    gw.sendAnswer = { outcome: 'rate_limited', retryAfterMs: 7000 };
    expect(await send.sendPost(req)).toEqual({ outcome: 'rate_limited', retryAfterMs: 7000 });
    expect(h.bots.rows[0]!.sendPausedUntil).toBeNull();
  });
});

describe('deletePost (AC-15)', () => {
  const dreq = { workspaceId: 'ws-a', telegramBotId: 100001n, chatId: CHAT, messageId: 55n };

  it('deletes the message through the workspace bot', async () => {
    const { gw, del } = setup();
    expect(await del.deletePost(dreq)).toEqual({ outcome: 'deleted' });
    expect(gw.calls[0]![0]).toBe('deletePost');
    expect(gw.calls[0]).toContain(CHAT);
    expect(gw.calls[0]).toContain(55n);
  });

  it('Telegram refusing means it can no longer be deleted by the bot', async () => {
    const { gw, del } = setup();
    gw.deleteAnswer = { outcome: 'refused' };
    expect(await del.deletePost(dreq)).toEqual({ outcome: 'refused' });
  });

  it('refuses a replaced bot before the call', async () => {
    const { gw, del } = setup([botRow({ telegramBotId: 999n })]);
    expect(await del.deletePost(dreq)).toEqual({ outcome: 'bot_changed' });
    expect(gw.calls).toEqual([]);
  });
});

describe('postReadiness (AC-07)', () => {
  it('gives state, telegramBotId and sendPausedUntil; null without a bot', async () => {
    const until = new Date(at(900));
    const { readiness } = setup([botRow({ sendPausedUntil: until })]);
    expect(await readiness.postReadiness('ws-a')).toEqual({
      state: 'connected',
      telegramBotId: 100001n,
      sendPausedUntil: until,
    });
    expect(await readiness.postReadiness('ws-other')).toBeNull();
  });
});
