import { describe, expect, it } from 'vitest';
import { matchTags } from './match';

const tag = (id: string, name: string) => ({ id, name });
// tag-list order, as listTags answers
const TAGS = [
  tag('1', 'Kyiv'),
  tag('2', 'Kyiv VIP clients'),
  tag('3', 'Vintage'),
  tag('4', 'VIP'),
  tag('5', 'Wholesale'),
];
const names = (m: ReturnType<typeof matchTags>) => m.rows.map((r) => r.tag.name);

describe('matchTags (SCR-20, AC-06, AC-08)', () => {
  it('lists every tag in tag-list order for an empty field, carried ones marked, no create row', () => {
    const m = matchTags(TAGS, '', ['4']);
    expect(names(m)).toEqual(['Kyiv', 'Kyiv VIP clients', 'Vintage', 'VIP', 'Wholesale']);
    expect(m.rows.find((r) => r.tag.id === '4')?.carried).toBe(true);
    expect(m.rows.filter((r) => r.carried)).toHaveLength(1);
    expect(m.create).toBeNull();
  });

  it('offers starts-with matches first, then contains matches, each in tag-list order', () => {
    const m = matchTags(TAGS, 'vi', []);
    expect(names(m)).toEqual(['Vintage', 'VIP', 'Kyiv VIP clients']);
    expect(m.create).toBe('vi');
  });

  it('ignores case and spacing when matching', () => {
    expect(names(matchTags(TAGS, '  KYI  ', []))).toEqual(['Kyiv', 'Kyiv VIP clients']);
    expect(names(matchTags(TAGS, 'kyiv   vip', []))).toEqual(['Kyiv VIP clients']);
  });

  it.each(['vip', ' VIP ', 'VIP  ', 'Vip'])(
    'an exact match «%s» offers only that tag and no create row',
    (typed) => {
      const m = matchTags(TAGS, typed, []);
      expect(names(m)).toEqual(['VIP']);
      expect(m.create).toBeNull();
    },
  );

  it('an exact match of a carried tag shows it as carried, still without a create row', () => {
    const m = matchTags(TAGS, 'vip', ['4']);
    expect(m.rows).toEqual([{ tag: tag('4', 'VIP'), carried: true }]);
    expect(m.create).toBeNull();
  });

  it('offers the tidied text as the create row when no tag has that name', () => {
    const m = matchTags(TAGS, '  New   York ', []);
    expect(m.rows).toEqual([]);
    expect(m.create).toBe('New York');
  });

  it('offers no create row for text that tidies to nothing', () => {
    expect(matchTags(TAGS, '   ', []).create).toBeNull();
    expect(names(matchTags(TAGS, '   ', []))).toHaveLength(5);
  });

  it('folds ß and SS together, as the server key does', () => {
    const m = matchTags([tag('9', 'Straße')], 'STRASSE', []);
    expect(names(m)).toEqual(['Straße']);
    expect(m.create).toBeNull();
  });

  it('treats a hidden joiner inside the text as the tag without it, as the server key does', () => {
    const m = matchTags(TAGS, 'V\u200CIP', []);
    expect(names(m)).toEqual(['VIP']);
    expect(m.create).toBeNull();
  });
});
