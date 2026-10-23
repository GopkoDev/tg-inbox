import { describe, expect, it } from 'vitest';
import {
  BROADCAST_NAME_MAX,
  BROADCAST_TEXT_MAX,
  broadcastTextLength,
  checkBroadcastName,
  checkBroadcastText,
  copyName,
  tagNameLength,
  tidyBroadcastName,
  tidyBroadcastText,
} from './index.js';

const EMOJI = '\u{1F600}'; // one grapheme, two UTF-16 code units
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // one grapheme, eight code units

describe('tidyBroadcastText', () => {
  it('removes spaces, line breaks and tabs at both ends', () => {
    expect(tidyBroadcastText('  \n\t Spring prices \t\n  ')).toBe('Spring prices');
    expect(tidyBroadcastText('\r\nHello\r\n')).toBe('Hello');
  });
  it('keeps inner line breaks and blank lines', () => {
    expect(tidyBroadcastText('\nLine one\n\nLine two\n')).toBe('Line one\n\nLine two');
    expect(tidyBroadcastText('a  \t b')).toBe('a  \t b');
  });
  it('tidies a text of only white space to empty', () => {
    expect(tidyBroadcastText(' \n \t \r\n ')).toBe('');
  });
});

describe('broadcastTextLength', () => {
  it('counts UTF-16 code units, so an emoji counts two', () => {
    expect(broadcastTextLength('abc')).toBe(3);
    expect(broadcastTextLength(EMOJI)).toBe(2);
    expect(broadcastTextLength(FAMILY)).toBe(8);
  });
});

describe('checkBroadcastText', () => {
  it('accepts a trimmed text and answers it with its length', () => {
    expect(checkBroadcastText('  Spring prices\n')).toEqual({
      ok: true,
      text: 'Spring prices',
      length: 13,
    });
  });
  it('refuses an empty or white-space-only text', () => {
    expect(checkBroadcastText('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkBroadcastText('  \n\t ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('accepts 4096 code units and refuses 4097 with the excess', () => {
    expect(BROADCAST_TEXT_MAX).toBe(4096);
    expect(checkBroadcastText('a'.repeat(4096)).ok).toBe(true);
    expect(checkBroadcastText('a'.repeat(4097))).toEqual({
      ok: false,
      reason: 'too_long',
      length: 4097,
      over: 1,
    });
  });
  it('accepts 2048 emoji (4096 units) and refuses one more emoji, two over', () => {
    expect(checkBroadcastText(EMOJI.repeat(2048)).ok).toBe(true);
    expect(checkBroadcastText(EMOJI.repeat(2049))).toEqual({
      ok: false,
      reason: 'too_long',
      length: 4098,
      over: 2,
    });
  });
  it('measures after trimming, so padding never pushes a text over', () => {
    expect(checkBroadcastText(`   ${'a'.repeat(4096)}\n\n`).ok).toBe(true);
  });
});

describe('tidyBroadcastName / checkBroadcastName', () => {
  it('tidies like a tag name', () => {
    expect(tidyBroadcastName('  Spring \n  prices​ ')).toBe('Spring prices');
  });
  it('accepts 1 to 80 graphemes, an emoji counting one', () => {
    expect(BROADCAST_NAME_MAX).toBe(80);
    expect(checkBroadcastName('a')).toEqual({ ok: true, name: 'a' });
    expect(checkBroadcastName('a'.repeat(80)).ok).toBe(true);
    expect(checkBroadcastName(FAMILY.repeat(80)).ok).toBe(true);
    expect(checkBroadcastName(` ${'a'.repeat(80)} `)).toEqual({ ok: true, name: 'a'.repeat(80) });
  });
  it('refuses an empty name and one of 81 graphemes', () => {
    expect(checkBroadcastName('')).toEqual({ ok: false });
    expect(checkBroadcastName(' ​\n ')).toEqual({ ok: false });
    expect(checkBroadcastName('a'.repeat(81))).toEqual({ ok: false });
    expect(checkBroadcastName(EMOJI.repeat(81))).toEqual({ ok: false });
  });
});

describe('copyName', () => {
  it('prefixes "Copy of "', () => {
    expect(copyName('Spring prices')).toBe('Copy of Spring prices');
  });
  it('cuts to 80 graphemes when the source is long', () => {
    const name = copyName('a'.repeat(80));
    expect(name).toBe(`Copy of ${'a'.repeat(72)}`);
    expect(tagNameLength(name)).toBe(80);
  });
  it('never cuts inside a grapheme', () => {
    const name = copyName(FAMILY.repeat(80));
    expect(name).toBe(`Copy of ${FAMILY.repeat(72)}`);
    expect(checkBroadcastName(name)).toEqual({ ok: true, name });
  });
  it('answers a valid name when the cut lands on a space', () => {
    const name = copyName(`${'a'.repeat(71)} bcd`);
    expect(name).toBe(`Copy of ${'a'.repeat(71)}`);
    expect(checkBroadcastName(name).ok).toBe(true);
  });
});
