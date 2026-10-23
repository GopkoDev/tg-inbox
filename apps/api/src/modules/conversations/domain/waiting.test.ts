import { describe, expect, it } from 'vitest';
import { endOnClose, restartOnReopen, startOnMessage } from './waiting.js';

const T = new Date('2026-10-11T10:00:00Z');
const LATER = new Date('2026-10-11T10:07:00Z');

describe('the waiting period (AC-07, AC-08, ADR-0007)', () => {
  it('a customer message starts a message period at its arrival when none is running', () => {
    expect(startOnMessage(null, T)).toEqual({ since: T, startedBy: 'message' });
  });

  it('a further message keeps the running period, whichever way it began', () => {
    expect(startOnMessage({ since: T, startedBy: 'message' }, LATER)).toEqual({
      since: T,
      startedBy: 'message',
    });
    expect(startOnMessage({ since: T, startedBy: 'reopen' }, LATER)).toEqual({
      since: T,
      startedBy: 'reopen',
    });
  });

  it('a close ends the period', () => {
    expect(endOnClose()).toBeNull();
  });

  it('a reopen over a waiting customer starts a reopen period at the reopen time', () => {
    expect(restartOnReopen(true, LATER)).toEqual({ since: LATER, startedBy: 'reopen' });
  });

  it('a reopen of an answered conversation starts nothing', () => {
    expect(restartOnReopen(false, LATER)).toBeNull();
  });
});
