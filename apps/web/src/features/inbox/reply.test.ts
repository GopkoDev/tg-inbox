import { describe, expect, it } from 'vitest';
import { REPLY_LIMIT, canSendReply } from './reply';

describe('reply validity (AC-13)', () => {
  it('limit is 4096', () => expect(REPLY_LIMIT).toBe(4096));
  it('rejects empty and whitespace-only', () => {
    expect(canSendReply('')).toBe(false);
    expect(canSendReply('   ')).toBe(false);
    expect(canSendReply(' \n\t ')).toBe(false);
  });
  it('rejects over the limit', () => expect(canSendReply('a'.repeat(4097))).toBe(false));
  it('accepts normal text and exactly the limit', () => {
    expect(canSendReply('Hi')).toBe(true);
    expect(canSendReply('a'.repeat(4096))).toBe(true);
  });
});
