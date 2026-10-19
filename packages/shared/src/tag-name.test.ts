import { describe, expect, it } from 'vitest';
import {
  TAG_NAME_MAX,
  checkTagName,
  compareTagListOrder,
  tagNameKey,
  tagNameLength,
  tidyTagName,
} from './index.js';

const key = (raw: string) => {
  const r = checkTagName(raw);
  if (!r.ok) throw new Error('invalid');
  return r.key;
};

describe('tidyTagName', () => {
  it('trims the ends and collapses every white-space run to one space', () => {
    expect(tidyTagName('  VIP  ')).toBe('VIP');
    expect(tidyTagName('V  I P')).toBe('V I P');
    expect(tidyTagName('New York')).toBe('New York');
    expect(tidyTagName('New\nYork')).toBe('New York');
    expect(tidyTagName('a \t\r\n  b')).toBe('a b');
  });
  it('removes the invisible zero-width spaces (U+200B, U+2060, U+FEFF)', () => {
    expect(tidyTagName('V\u200BI\u2060P\uFEFF')).toBe('VIP');
  });
  it('keeps the joiners that hold emoji and some scripts together, trimming them at the ends', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(tidyTagName(family)).toBe(family);
    expect(tidyTagName('\u0645\u200C\u0646')).toBe('\u0645\u200C\u0646');
    expect(tidyTagName('\u200D VIP \u200C')).toBe('VIP');
    expect(tidyTagName(' \u200D\u200B VIP')).toBe('VIP');
  });
  it('normalises to NFC', () => {
    expect(tidyTagName('é')).toBe('é');
  });
  it('keeps the letter case as typed', () => {
    expect(tidyTagName(' vIp ')).toBe('vIp');
  });
});

describe('tagNameLength', () => {
  it('counts graphemes', () => {
    expect(tagNameLength('😀')).toBe(1);
    expect(tagNameLength('👨‍👩‍👧')).toBe(1);
    expect(tagNameLength('ab')).toBe(2);
  });
});

describe('checkTagName', () => {
  it('refuses empty, blank and zero-width-only names', () => {
    expect(checkTagName('')).toEqual({ ok: false });
    expect(checkTagName('   ')).toEqual({ ok: false });
    expect(checkTagName('​⁠')).toEqual({ ok: false });
    // a name made only of joiners or other invisible characters is empty too
    expect(checkTagName('\u200D')).toEqual({ ok: false });
    expect(checkTagName('\u200C\u200D \u200B\uFEFF')).toEqual({ ok: false });
  });
  it('counts a joined emoji as one character (AC-07)', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const r = checkTagName(family);
    expect(r).toEqual({ ok: true, name: family, key: family });
    expect(tagNameLength(r.ok ? r.name : '')).toBe(1);
    expect(checkTagName(family.repeat(32)).ok).toBe(true);
    expect(checkTagName(family.repeat(33))).toEqual({ ok: false });
  });
  it('accepts 32 graphemes and refuses 33, emoji counting as one', () => {
    expect(TAG_NAME_MAX).toBe(32);
    expect(checkTagName('😀'.repeat(32)).ok).toBe(true);
    expect(checkTagName('😀'.repeat(33))).toEqual({ ok: false });
    expect(checkTagName('a'.repeat(32)).ok).toBe(true);
    expect(checkTagName('a'.repeat(33))).toEqual({ ok: false });
  });
  it('measures the length after collapsing inner spaces', () => {
    expect(checkTagName(`  ${'a '.repeat(16)}${' '.repeat(5)}`.trimEnd() + '  ').ok).toBe(true);
    expect(checkTagName('a' + ' '.repeat(40) + 'b')).toEqual({ ok: true, name: 'a b', key: 'a b' });
  });
  it('returns the tidied name and the key', () => {
    expect(checkTagName(' VIP ')).toEqual({ ok: true, name: 'VIP', key: 'vip' });
  });
  it('gives vip, " VIP " and "VIP  " the key of VIP, and V  I P another', () => {
    expect(key('vip')).toBe(key('VIP'));
    expect(key(' VIP ')).toBe(key('VIP'));
    expect(key('VIP  ')).toBe(key('VIP'));
    expect(key('V  I P')).not.toBe(key('VIP'));
    expect(checkTagName('V  I P')).toMatchObject({ name: 'V I P' });
  });
  it('folds sharp s, Cyrillic and decomposed forms together', () => {
    expect(key('Straße')).toBe(key('STRASSE'));
    expect(key('Ёлка')).toBe(key('ёлка'));
    expect(key('é')).toBe(key('é'));
  });
});

describe('tagNameKey', () => {
  it('is toUpperCase then toLowerCase', () => {
    expect(tagNameKey('Straße')).toBe('strasse');
    expect(tagNameKey('ΣΑΣ')).toBe(tagNameKey('σας'));
  });
});

describe('compareTagListOrder', () => {
  const a = (name: string) => ({ name, key: tagNameKey(name) });
  it('orders ignoring case', () => {
    const sorted = ['beta', 'Alpha', 'gamma', 'Delta'].map(a).sort(compareTagListOrder);
    expect(sorted.map((t) => t.name)).toEqual(['Alpha', 'beta', 'Delta', 'gamma']);
  });
  it('uses the key as tiebreak when names compare equal', () => {
    const x = { name: 'a', key: 'k1' };
    const y = { name: 'A', key: 'k2' };
    expect(compareTagListOrder(x, y)).toBeLessThan(0);
    expect(compareTagListOrder(y, x)).toBeGreaterThan(0);
    expect(compareTagListOrder(x, x)).toBe(0);
  });
});
