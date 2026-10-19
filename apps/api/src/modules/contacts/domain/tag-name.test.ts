import { describe, expect, it } from 'vitest';
import {
  TAG_NAME_MAX,
  checkTagName,
  compareTagListOrder,
  tagNameKey,
  tidyTagName,
} from './tag-name.js';

describe('contacts domain tag-name re-export', () => {
  it('exposes the shared rules', () => {
    expect(TAG_NAME_MAX).toBe(32);
    expect(tidyTagName('  V  I P ')).toBe('V I P');
    expect(tagNameKey('Straße')).toBe(tagNameKey('STRASSE'));
    expect(checkTagName(' vip ')).toEqual({ ok: true, name: 'vip', key: 'vip' });
    expect(checkTagName('😀'.repeat(33))).toEqual({ ok: false });
    expect(
      [
        { name: 'b', key: 'b' },
        { name: 'A', key: 'a' },
      ]
        .sort(compareTagListOrder)
        .map((t) => t.name),
    ).toEqual(['A', 'b']);
  });
});
