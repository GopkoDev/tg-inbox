import { describe, expect, it } from 'vitest';
import { botRow, createBotsHarness, at } from './harness.js';
import { createPingReadiness } from './ping-readiness.js';

describe('pingReadiness', () => {
  it('returns the state, Telegram bot id, username and the send pause', async () => {
    const h = createBotsHarness([
      botRow({ state: 'taken_over', telegramBotId: 424242n, sendPausedUntil: at(900) }),
    ]);
    const readiness = createPingReadiness({ bots: h.bots });
    expect(await readiness.pingReadiness('ws-a')).toEqual({
      state: 'taken_over',
      telegramBotId: 424242n,
      username: 'old_name_bot',
      sendPausedUntil: at(900),
    });
  });

  it('has a null pause when none was stored, and answers null for a workspace without a bot', async () => {
    const h = createBotsHarness([botRow()]);
    const readiness = createPingReadiness({ bots: h.bots });
    expect(await readiness.pingReadiness('ws-a')).toMatchObject({ sendPausedUntil: null });
    expect(await readiness.pingReadiness('ws-b')).toBeNull();
  });
});
