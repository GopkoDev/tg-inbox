import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_LIMIT,
  audienceFingerprint,
  checkAudienceSize,
  checkTagAudience,
  fitsAudience,
  splitExistingTags,
} from './audience.js';

const id = (n: number) => `0190a1b2-c3d4-7e5f-8a9b-${String(n).padStart(12, '0')}`;

describe('the 10 000 limit (AC-05)', () => {
  it('allows 10 000 contacts and refuses 10 001, with how many can still be added', () => {
    expect(AUDIENCE_LIMIT).toBe(10_000);
    expect(checkAudienceSize(0)).toEqual({ ok: true, canAdd: 10_000 });
    expect(checkAudienceSize(9_990)).toEqual({ ok: true, canAdd: 10 });
    expect(checkAudienceSize(10_000)).toEqual({ ok: true, canAdd: 0 });
    expect(checkAudienceSize(10_001)).toEqual({ ok: false, canAdd: 0 });
  });
  it('a bulk add fits as a whole or not at all', () => {
    expect(fitsAudience(9_990, 10)).toBe(true);
    expect(fitsAudience(9_990, 50)).toBe(false);
    expect(fitsAudience(10_000, 0)).toBe(true);
  });
});

describe('tag audience shape (AC-01)', () => {
  it('a tag is chosen or left out, never both; "no tags" takes no tag at all', () => {
    expect(checkTagAudience({ mode: 'any', include: [id(1)], exclude: [id(2)] })).toEqual({
      ok: true,
    });
    expect(checkTagAudience({ mode: 'all', include: [], exclude: [] })).toEqual({ ok: true });
    expect(checkTagAudience({ mode: 'none', include: [], exclude: [] })).toEqual({ ok: true });
    expect(checkTagAudience({ mode: 'none', include: [id(1)], exclude: [] })).toEqual({
      ok: false,
      field: 'tag_ids',
    });
    expect(checkTagAudience({ mode: 'none', include: [], exclude: [id(2)] })).toEqual({
      ok: false,
      field: 'tag_ids',
    });
    expect(checkTagAudience({ mode: 'any', include: [id(1)], exclude: [id(1)] })).toEqual({
      ok: false,
      field: 'exclude_tag_ids',
    });
  });

  it('keeps the stored tags that still exist and reports the dropped ones by stored name', () => {
    const stored = [
      { tagId: id(1), name: 'VIP', kind: 'include' as const },
      { tagId: id(2), name: 'Old name', kind: 'include' as const },
      { tagId: id(3), name: 'Staff', kind: 'exclude' as const },
    ];
    expect(splitExistingTags(stored, new Set([id(1), id(3)]))).toEqual({
      kept: [stored[0], stored[2]],
      dropped: [{ tagId: id(2), name: 'Old name', kind: 'include' }],
    });
    expect(splitExistingTags(stored, new Set())).toEqual({ kept: [], dropped: stored });
  });
});

describe('audience fingerprint (AC-06, ADR-0006)', () => {
  const ids = Array.from({ length: 36 }, (_, i) => id(i + 1));
  it('is the SHA-256 hex of the ids sorted ascending, one per line', () => {
    const expected = createHash('sha256')
      .update([...ids].sort().join('\n'))
      .digest('hex');
    expect(audienceFingerprint([...ids].reverse())).toBe(expected);
    expect(audienceFingerprint(ids)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is the same for the same set in any order and differs for another contact at the same count', () => {
    const shuffled = [...ids.slice(18), ...ids.slice(0, 18)];
    expect(audienceFingerprint(shuffled)).toBe(audienceFingerprint(ids));
    const swapped = [...ids.slice(0, 35), id(99)];
    expect(audienceFingerprint(swapped)).not.toBe(audienceFingerprint(ids));
  });
  it('does not mutate the given list', () => {
    const given = [id(3), id(1), id(2)];
    audienceFingerprint(given);
    expect(given).toEqual([id(3), id(1), id(2)]);
  });
});
