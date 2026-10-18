import { describe, expect, it } from 'vitest';
import { canTransition, FAILURE_REASONS, REPLY_STATES, type ReplyState } from './reply.js';

describe('reply states (AC-11, AC-12)', () => {
  it('mirrors the replies.state CHECK list', () => {
    expect([...REPLY_STATES]).toEqual(['sending', 'sent', 'not_delivered', 'not_confirmed']);
  });

  it('mirrors the replies.failure_reason CHECK list', () => {
    expect([...FAILURE_REASONS].sort()).toEqual(
      [
        'customer_blocked',
        'customer_account_gone',
        'chat_not_found',
        'bot_not_working',
        'author_access_removed',
        'telegram_not_accepted',
        'delivery_interrupted',
      ].sort(),
    );
  });

  const allowed: [ReplyState, ReplyState][] = [
    ['sending', 'sent'],
    ['sending', 'not_delivered'],
    ['sending', 'not_confirmed'],
    ['not_delivered', 'sending'],
    ['not_confirmed', 'sending'],
  ];

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('refuses every other pair, including self-transitions', () => {
    for (const from of REPLY_STATES) {
      for (const to of REPLY_STATES) {
        const ok = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(ok);
      }
    }
  });

  it('treats sent as final (cannot be re-queued)', () => {
    for (const to of REPLY_STATES) expect(canTransition('sent', to)).toBe(false);
  });

  it('does not allow re-queueing a reply that is still sending', () => {
    expect(canTransition('sending', 'sending')).toBe(false);
  });
});
