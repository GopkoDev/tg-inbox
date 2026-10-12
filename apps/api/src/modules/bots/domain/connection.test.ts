import { describe, expect, it } from 'vitest';
import { BOT_STATES, decidePaste, isLive } from './connection.js';

describe('BOT_STATES', () => {
  it('mirrors the bots_state_check values', () => {
    expect([...BOT_STATES]).toEqual(['connected', 'needs_token', 'taken_over', 'disconnected']);
  });

  it('treats every state but disconnected as live', () => {
    expect(BOT_STATES.filter(isLive)).toEqual(['connected', 'needs_token', 'taken_over']);
  });
});

describe('decidePaste (AC-01, AC-05, AC-17, AC-18)', () => {
  it('connects when the workspace has no bot row', () => {
    expect(decidePaste(null, 10n)).toEqual({ action: 'connect' });
  });

  it('connects again when the same bot was disconnected', () => {
    expect(decidePaste({ state: 'disconnected', telegramBotId: 10n }, 10n)).toEqual({
      action: 'connectAgain',
    });
  });

  it.each(['connected', 'needs_token', 'taken_over'] as const)(
    'rotates the token of the same bot while %s',
    (state) => {
      expect(decidePaste({ state, telegramBotId: 10n }, 10n)).toEqual({ action: 'rotate' });
    },
  );

  it.each(['connected', 'needs_token', 'taken_over'] as const)(
    'refuses a different bot while the workspace bot is %s (reason connected)',
    (state) => {
      expect(decidePaste({ state, telegramBotId: 10n }, 11n)).toEqual({
        action: 'refuse',
        reason: 'connected',
      });
    },
  );

  it('refuses a different bot once the workspace kept its bot for history', () => {
    expect(decidePaste({ state: 'disconnected', telegramBotId: 10n }, 11n)).toEqual({
      action: 'refuse',
      reason: 'history',
    });
  });
});
