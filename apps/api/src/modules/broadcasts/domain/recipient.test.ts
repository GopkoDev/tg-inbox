import { describe, expect, it } from 'vitest';
import {
  FIXABLE_REASONS,
  isNotReached,
  notReachedStates,
  outcomeOf,
  type SendAnswer,
} from './recipient.js';

const until = new Date('2026-10-23T09:00:30Z');

describe('Telegram answer -> recipient outcome (ADR-0009, AC-11, AC-12, AC-15)', () => {
  it.each<[string, SendAnswer, unknown]>([
    [
      'delivered',
      { kind: 'delivered', messageId: 42n },
      { record: { state: 'delivered', telegramMessageId: 42n } },
    ],
    ['blocked', { kind: 'blocked' }, { record: { state: 'blocked' } }],
    [
      'account gone',
      { kind: 'account_gone' },
      { record: { state: 'failed', reason: 'account_gone' } },
    ],
    [
      'chat not found',
      { kind: 'chat_not_found' },
      { record: { state: 'failed', reason: 'chat_not_found' } },
    ],
    [
      'other Telegram error',
      { kind: 'telegram_error' },
      { record: { state: 'failed', reason: 'telegram_error' } },
    ],
    ['no answer', { kind: 'no_answer' }, { record: { state: 'not_confirmed' } }],
    [
      'rate limited',
      { kind: 'rate_limited', retryAfterSeconds: 7 },
      { requeue: { retryAfterSeconds: 7 } },
    ],
    ['paused', { kind: 'paused', until }, { requeue: { until } }],
    ['text refused', { kind: 'text_refused' }, { abort: 'text_refused' }],
    ['bot unavailable', { kind: 'bot_unavailable' }, { abort: 'bot_stopped' }],
    ['bot changed', { kind: 'bot_changed' }, { abort: 'bot_stopped' }],
  ])('%s', (_name, answer, expected) => {
    expect(outcomeOf(answer)).toEqual(expected);
  });
});

describe('"only recipients it did not reach" (AC-13)', () => {
  it('copies failed with a fixable reason and stopped; not confirmed only when asked', () => {
    expect([...FIXABLE_REASONS].sort()).toEqual(['bot_stopped', 'telegram_error', 'text_refused']);
    expect(notReachedStates(false)).toEqual({
      states: ['stopped'],
      failedReasons: FIXABLE_REASONS,
    });
    expect(notReachedStates(true)).toEqual({
      states: ['stopped', 'not_confirmed'],
      failedReasons: FIXABLE_REASONS,
    });
  });
  it.each<[string, { state: string; failureReason: string | null }, boolean, boolean]>([
    ['stopped', { state: 'stopped', failureReason: null }, true, true],
    ['failed bot_stopped', { state: 'failed', failureReason: 'bot_stopped' }, true, true],
    ['failed text_refused', { state: 'failed', failureReason: 'text_refused' }, true, true],
    ['failed telegram_error', { state: 'failed', failureReason: 'telegram_error' }, true, true],
    ['failed account_gone', { state: 'failed', failureReason: 'account_gone' }, false, false],
    ['failed chat_not_found', { state: 'failed', failureReason: 'chat_not_found' }, false, false],
    ['not confirmed', { state: 'not_confirmed', failureReason: null }, false, true],
    ['delivered', { state: 'delivered', failureReason: null }, false, false],
    ['blocked', { state: 'blocked', failureReason: null }, false, false],
  ])('%s: without / with not confirmed', (_name, r, without, withNotConfirmed) => {
    expect(isNotReached(r as never, false)).toBe(without);
    expect(isNotReached(r as never, true)).toBe(withNotConfirmed);
  });
});
