import { describe, expect, it } from 'vitest';
import { checkReplyText } from './reply-text.js';

describe('checkReplyText (AC-07)', () => {
  it('accepts ordinary text', () => {
    expect(checkReplyText('Your order is on its way')).toBe('ok');
  });

  it.each(['', ' ', '   ', '\n', ' \n\t \r\n '])('rejects blank %j', (text) => {
    expect(checkReplyText(text)).toBe('blank');
  });

  it('accepts exactly 4096 UTF-16 units', () => {
    expect(checkReplyText('a'.repeat(4096))).toBe('ok');
  });

  it('rejects 4097 units', () => {
    expect(checkReplyText('a'.repeat(4097))).toBe('too_long');
  });

  it('counts emoji as two UTF-16 units', () => {
    const emoji = '😀';
    expect(emoji.length).toBe(2);
    expect(checkReplyText(emoji.repeat(2048))).toBe('ok');
    expect(checkReplyText(emoji.repeat(2049))).toBe('too_long');
    // 4096 code points, 8192 units
    expect(checkReplyText(emoji.repeat(4096))).toBe('too_long');
  });

  it('judges length on the raw text, not the trimmed text', () => {
    expect(checkReplyText('a' + ' '.repeat(4096))).toBe('too_long');
  });
});
