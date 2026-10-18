import { describe, expect, it } from 'vitest';
import { belongsToLens, DEFAULT_LENS, parseLens, withLens } from './lens';

const p = (s: string) => new URLSearchParams(s);
const ME = '0198f0c0-0000-7000-8000-0000000000aa';
const OTHER = '0198f0c0-0000-7000-8000-0000000000bb';
const row = (status: 'open' | 'closed', assignee: string | null) => ({
  status,
  assignee: assignee ? { account_id: assignee, display_name: 'X' } : null,
});

describe('lens: address', () => {
  it('no parameters is open · all and canonical', () => {
    expect(parseLens(p(''))).toEqual({ lens: DEFAULT_LENS, canonical: true });
  });

  it('reads both lenses from the address', () => {
    expect(parseLens(p('status=closed&assignee=mine'))).toEqual({
      lens: { status: 'closed', assignee: 'mine' },
      canonical: true,
    });
  });

  it('an unknown value is the default and the address is not canonical', () => {
    expect(parseLens(p('assignee=everyone'))).toEqual({ lens: DEFAULT_LENS, canonical: false });
    expect(parseLens(p('status=CLOSED&assignee=mine'))).toEqual({
      lens: { status: 'open', assignee: 'mine' },
      canonical: false,
    });
  });

  it('an explicit default is not canonical (defaults are omitted)', () => {
    expect(parseLens(p('status=open')).canonical).toBe(false);
  });

  it('writes lenses with defaults omitted and keeps other parameters', () => {
    expect(withLens(p('x=1'), { status: 'closed', assignee: 'all' }).toString()).toBe(
      'x=1&status=closed',
    );
    expect(withLens(p('status=closed&assignee=mine'), DEFAULT_LENS).toString()).toBe('');
    expect(withLens(p('assignee=bad'), { status: 'open', assignee: 'unassigned' }).toString()).toBe(
      'assignee=unassigned',
    );
  });
});

describe('lens: membership', () => {
  it('open · all holds open rows of every assignee', () => {
    expect(belongsToLens(row('open', OTHER), DEFAULT_LENS, ME, false)).toBe(true);
    expect(belongsToLens(row('closed', null), DEFAULT_LENS, ME, false)).toBe(false);
  });

  it('mine and unassigned filter by assignee', () => {
    const mine = { status: 'open', assignee: 'mine' } as const;
    const none = { status: 'open', assignee: 'unassigned' } as const;
    expect(belongsToLens(row('open', ME), mine, ME, false)).toBe(true);
    expect(belongsToLens(row('open', OTHER), mine, ME, false)).toBe(false);
    expect(belongsToLens(row('open', null), mine, ME, false)).toBe(false);
    expect(belongsToLens(row('open', null), none, ME, false)).toBe(true);
    expect(belongsToLens(row('open', ME), none, ME, false)).toBe(false);
  });

  it('closed holds closed rows', () => {
    expect(
      belongsToLens(row('closed', null), { status: 'closed', assignee: 'all' }, ME, false),
    ).toBe(true);
  });

  it('while searching only the assignee lens counts', () => {
    expect(belongsToLens(row('closed', ME), { status: 'open', assignee: 'mine' }, ME, true)).toBe(
      true,
    );
    expect(
      belongsToLens(row('closed', OTHER), { status: 'open', assignee: 'mine' }, ME, true),
    ).toBe(false);
  });
});
