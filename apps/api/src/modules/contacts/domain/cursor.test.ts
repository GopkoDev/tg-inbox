import { describe, expect, it } from 'vitest';
import {
  contactFilterKey,
  decodeContactCursor,
  decodeHistoryCursor,
  encodeContactCursor,
  encodeHistoryCursor,
} from './cursor.js';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const at = new Date('2026-10-19T10:00:00.123Z');
const key = contactFilterKey({ q: 'olena', mode: 'all', tagIds: [ID, 'b'] });

describe('contacts list cursor', () => {
  it('round-trips a dated position and the NULL tail', () => {
    for (const p of [
      { lastWroteAt: at, id: ID },
      { lastWroteAt: null, id: ID },
    ]) {
      const c = encodeContactCursor(p, key);
      expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(c.length).toBeLessThanOrEqual(200);
      expect(decodeContactCursor(c, key)).toEqual(p);
    }
  });

  it('is bound to the search and the filter it was issued for', () => {
    const c = encodeContactCursor({ lastWroteAt: at, id: ID }, key);
    expect(
      decodeContactCursor(c, contactFilterKey({ q: 'other', mode: 'all', tagIds: [ID, 'b'] })),
    ).toBeNull();
    expect(
      decodeContactCursor(c, contactFilterKey({ q: 'olena', mode: 'any', tagIds: [ID, 'b'] })),
    ).toBeNull();
    expect(
      decodeContactCursor(c, contactFilterKey({ q: 'olena', mode: 'all', tagIds: [ID] })),
    ).toBeNull();
  });

  it('keys ignore the order of the tag ids', () => {
    expect(contactFilterKey({ q: null, mode: 'any', tagIds: ['a', 'b'] })).toBe(
      contactFilterKey({ q: null, mode: 'any', tagIds: ['b', 'a'] }),
    );
  });

  it.each(['', '!!!', 'garbage', Buffer.from('[]').toString('base64url')])('rejects %j', (bad) => {
    expect(decodeContactCursor(bad, key)).toBeNull();
    expect(decodeHistoryCursor(bad)).toBeNull();
  });

  it('does not mix with the history cursor', () => {
    expect(decodeHistoryCursor(encodeContactCursor({ lastWroteAt: at, id: ID }, key))).toBeNull();
    expect(decodeContactCursor(encodeHistoryCursor({ createdAt: at, id: ID }), key)).toBeNull();
  });
});

describe('tag history cursor', () => {
  it('round-trips (created_at, id)', () => {
    const c = encodeHistoryCursor({ createdAt: at, id: ID });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeHistoryCursor(c)).toEqual({ createdAt: at, id: ID });
  });
});

describe('crafted cursors never reach the database casts', () => {
  const craft = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

  it.each(['x', 'not-a-uuid', `${ID}x`, ID.replace(/-/g, '')])(
    'refuses a position id %j that is not a uuid',
    (id) => {
      expect(decodeContactCursor(craft({ k: 'c', at: at.getTime(), id, f: key }), key)).toBeNull();
      expect(decodeContactCursor(craft({ k: 'c', at: null, id, f: key }), key)).toBeNull();
      expect(decodeHistoryCursor(craft({ k: 'h', at: at.getTime(), id }))).toBeNull();
    },
  );

  it.each([-8.64e15, -1, 8.64e15, 253402300800000])(
    'refuses a time %d outside 1970 .. 9999 (Postgres would answer timestamp out of range)',
    (ms) => {
      expect(decodeContactCursor(craft({ k: 'c', at: ms, id: ID, f: key }), key)).toBeNull();
      expect(decodeHistoryCursor(craft({ k: 'h', at: ms, id: ID }))).toBeNull();
    },
  );

  it('accepts the bounds and an upper-case uuid', () => {
    expect(decodeHistoryCursor(craft({ k: 'h', at: 0, id: ID.toUpperCase() }))).toEqual({
      createdAt: new Date(0),
      id: ID.toUpperCase(),
    });
    expect(decodeHistoryCursor(craft({ k: 'h', at: 253402300799999, id: ID }))).not.toBeNull();
  });
});
