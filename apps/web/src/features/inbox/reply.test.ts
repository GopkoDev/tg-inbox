import { describe, expect, it } from 'vitest';
import { REPLY_LIMIT, canSendReply, isTooLong } from './reply';

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

describe('UTF-16 limit (AC-07)', () => {
  it('counts UTF-16 units: 4096 code points of an astral char are over the limit', () => {
    const text = '😀'.repeat(4096);
    expect(Array.from(text)).toHaveLength(4096);
    expect(isTooLong(text)).toBe(true);
    expect(canSendReply(text)).toBe(false);
  });
  it('exactly 4096 units is not too long', () => expect(isTooLong('a'.repeat(4096))).toBe(false));
});
