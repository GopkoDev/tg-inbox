import { describe, expect, it } from 'vitest';
import { EMPTY_ADDRESS, isFiltered, parseAddress, withAddress } from './address';

const T1 = '0198f0c0-0000-7000-8000-000000000301';
const T2 = '0198f0c0-0000-7000-8000-000000000302';
const params = (text: string) => new URLSearchParams(text);

describe('parseAddress', () => {
  it('reads search, mode and tag ids from the address', () => {
    const { address, canonical } = parseAddress(params(`q=ada&mode=all&tag=${T1}&tag=${T2}`));
    expect(address).toEqual({ q: 'ada', mode: 'all', tagIds: [T1, T2] });
    expect(canonical).toBe(true);
  });

  it('an empty address is the empty view and canonical', () => {
    expect(parseAddress(params(''))).toEqual({ address: EMPTY_ADDRESS, canonical: true });
  });

  it('drops a malformed tag id, a duplicate and an unknown mode, and asks for a rewrite', () => {
    const { address, canonical } = parseAddress(
      params(`mode=sideways&tag=nope&tag=${T1}&tag=${T1}`),
    );
    expect(address).toEqual({ q: '', mode: 'any', tagIds: [T1] });
    expect(canonical).toBe(false);
  });

  it('drops the tags that come with mode none, and asks for a rewrite', () => {
    const { address, canonical } = parseAddress(params(`mode=none&tag=${T1}`));
    expect(address).toEqual({ q: '', mode: 'none', tagIds: [] });
    expect(canonical).toBe(false);
  });

  it('a spelled-out default mode or an empty search is rewritten away', () => {
    expect(parseAddress(params('mode=any')).canonical).toBe(false);
    expect(parseAddress(params('q=')).canonical).toBe(false);
  });

  it('trims the search text', () => {
    const { address, canonical } = parseAddress(params('q=%20ada%20'));
    expect(address.q).toBe('ada');
    expect(canonical).toBe(false);
  });
});

describe('withAddress', () => {
  it('writes only what differs from the empty view and keeps other parameters', () => {
    expect(withAddress(params('x=1'), EMPTY_ADDRESS).toString()).toBe('x=1');
    const next = withAddress(params('x=1'), { q: 'ada', mode: 'all', tagIds: [T1, T2] });
    expect(next.get('q')).toBe('ada');
    expect(next.get('mode')).toBe('all');
    expect(next.getAll('tag')).toEqual([T1, T2]);
    expect(next.get('x')).toBe('1');
  });

  it('writes mode only when it is not any, and no tag with none', () => {
    expect(withAddress(params(''), { q: '', mode: 'any', tagIds: [T1] }).has('mode')).toBe(false);
    const none = withAddress(params(`tag=${T1}`), { q: '', mode: 'none', tagIds: [T1] });
    expect(none.get('mode')).toBe('none');
    expect(none.has('tag')).toBe(false);
  });

  it('round-trips through parseAddress', () => {
    const address = { q: 'ada b', mode: 'all' as const, tagIds: [T2, T1] };
    expect(parseAddress(withAddress(params(''), address))).toEqual({ address, canonical: true });
  });
});

describe('isFiltered', () => {
  it('is true for a search, a tag or a mode other than any', () => {
    expect(isFiltered(EMPTY_ADDRESS)).toBe(false);
    expect(isFiltered({ ...EMPTY_ADDRESS, q: 'a' })).toBe(true);
    expect(isFiltered({ ...EMPTY_ADDRESS, tagIds: [T1] })).toBe(true);
    expect(isFiltered({ ...EMPTY_ADDRESS, mode: 'none' })).toBe(true);
    expect(isFiltered({ ...EMPTY_ADDRESS, mode: 'all' })).toBe(false);
  });
});
