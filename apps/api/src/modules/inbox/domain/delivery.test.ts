import { describe, expect, it } from 'vitest';
import { decideOutcome } from './delivery.js';

const positionAt = new Date('2026-01-01T10:00:00.000Z');
const at = (ms: number) => new Date(positionAt.getTime() + ms);
// The next try (after the back-off) still lands inside the 5-minute window.
const WITHIN = 4 * 60_000;
const AFTER = 5 * 60_000 + 1_000;

describe('decideOutcome (AC-10, AC-11, AC-12, AC-13)', () => {
  it('accepted -> sent, drain continues', () => {
    const r = decideOutcome(
      { outcome: 'accepted', messageId: 1n, at: at(1000) },
      positionAt,
      at(1000),
    );
    expect(r).toMatchObject({
      attemptOutcome: 'accepted',
      replyState: 'sent',
      drainContinues: true,
    });
    expect(r.failureReason).toBeUndefined();
  });

  it.each([
    ['blocked', 'customer_blocked'],
    ['account_gone', 'customer_account_gone'],
    ['chat_not_found', 'chat_not_found'],
  ] as const)('refused %s -> not_delivered / %s', (reason, failureReason) => {
    const r = decideOutcome({ outcome: 'refused', reason }, positionAt, at(1000));
    expect(r).toMatchObject({
      attemptOutcome: 'refused',
      replyState: 'not_delivered',
      failureReason,
      drainContinues: true,
    });
  });

  it('bot_unauthorized -> not_delivered / bot_not_working', () => {
    const r = decideOutcome({ outcome: 'bot_unauthorized' }, positionAt, at(1000));
    expect(r).toMatchObject({
      attemptOutcome: 'bot_unauthorized',
      replyState: 'not_delivered',
      failureReason: 'bot_not_working',
      drainContinues: true,
    });
  });

  it('not_accepted within 5 min with retry_after stays sending, drain stops, retries after 7 s', () => {
    const r = decideOutcome(
      { outcome: 'not_accepted', retryAfterMs: 7000 },
      positionAt,
      at(WITHIN),
    );
    expect(r).toMatchObject({
      attemptOutcome: 'not_accepted',
      replyState: 'sending',
      drainContinues: false,
      retryAfterMs: 7000,
    });
    expect(r.failureReason).toBeUndefined();
  });

  it('not_accepted within 5 min without retry_after still stays sending and stops the drain', () => {
    const r = decideOutcome({ outcome: 'not_accepted' }, positionAt, at(1000));
    expect(r).toMatchObject({ replyState: 'sending', drainContinues: false });
  });

  it('not_accepted after 5 min -> not_delivered / telegram_not_accepted, drain continues', () => {
    const r = decideOutcome({ outcome: 'not_accepted' }, positionAt, at(AFTER));
    expect(r).toMatchObject({
      attemptOutcome: 'not_accepted',
      replyState: 'not_delivered',
      failureReason: 'telegram_not_accepted',
      drainContinues: true,
    });
    expect(r.retryAfterMs).toBeUndefined();
  });

  it('not_accepted with retry_after after 5 min is also final', () => {
    const r = decideOutcome({ outcome: 'not_accepted', retryAfterMs: 7000 }, positionAt, at(AFTER));
    expect(r).toMatchObject({ replyState: 'not_delivered', drainContinues: true });
  });

  it('a next try landing exactly at 5 min is still within the window', () => {
    const r = decideOutcome({ outcome: 'not_accepted' }, positionAt, at(295_000));
    expect(r).toMatchObject({ replyState: 'sending', drainContinues: false });
  });

  it('a retry_after that would land past 5 min ends not_delivered now (B6, AC-12)', () => {
    const r = decideOutcome(
      { outcome: 'not_accepted', retryAfterMs: 60_000 },
      positionAt,
      at(280_000),
    );
    expect(r).toMatchObject({
      attemptOutcome: 'not_accepted',
      replyState: 'not_delivered',
      failureReason: 'telegram_not_accepted',
      drainContinues: true,
    });
  });

  it('the default back-off past 5 min also ends not_delivered now (B6)', () => {
    const r = decideOutcome({ outcome: 'not_accepted' }, positionAt, at(297_000));
    expect(r).toMatchObject({
      replyState: 'not_delivered',
      failureReason: 'telegram_not_accepted',
    });
  });

  it('a retry_after is rounded up to whole seconds, as the delayed job is', () => {
    const r = decideOutcome(
      { outcome: 'not_accepted', retryAfterMs: 4_100 },
      positionAt,
      at(295_500),
    );
    expect(r).toMatchObject({ replyState: 'not_delivered' });
  });

  it('unknown -> not_confirmed, never retried, drain continues', () => {
    const r = decideOutcome({ outcome: 'unknown' }, positionAt, at(1000));
    expect(r).toMatchObject({
      attemptOutcome: 'unknown',
      replyState: 'not_confirmed',
      drainContinues: true,
    });
    expect(r.retryAfterMs).toBeUndefined();
  });
});
