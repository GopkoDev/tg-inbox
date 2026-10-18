import { describe, expect, it } from 'vitest';
import {
  compareThreadPosition,
  decodeListCursor,
  decodeThreadCursor,
  encodeListCursor,
  encodeThreadCursor,
  type ThreadPosition,
} from './thread.js';

const t = (s: number, ms = 0) => new Date(Date.UTC(2026, 9, 11, 10, 0, s, ms));
const msg = (s: number, id: bigint): ThreadPosition => ({ positionAt: t(s), kind: 'message', id });
const reply = (s: number, id: string): ThreadPosition => ({ positionAt: t(s), kind: 'reply', id });
const activity = (s: number, id: string): ThreadPosition => ({
  positionAt: t(s),
  kind: 'activity',
  id,
});

describe('compareThreadPosition (AC-03)', () => {
  it('orders by position time first', () => {
    expect(compareThreadPosition(msg(1, 9n), reply(2, 'a'))).toBeLessThan(0);
    expect(compareThreadPosition(reply(3, 'a'), msg(2, 1n))).toBeGreaterThan(0);
  });

  it('puts a message before a reply in the same second', () => {
    expect(compareThreadPosition(msg(5, 1n), reply(5, 'a'))).toBeLessThan(0);
    expect(compareThreadPosition(reply(5, 'a'), msg(5, 1n))).toBeGreaterThan(0);
  });

  it('breaks message ties by telegram_message_id', () => {
    expect(compareThreadPosition(msg(5, 10n), msg(5, 11n))).toBeLessThan(0);
    expect(compareThreadPosition(msg(5, 11n), msg(5, 10n))).toBeGreaterThan(0);
  });

  it('breaks reply ties by id', () => {
    expect(compareThreadPosition(reply(5, 'a'), reply(5, 'b'))).toBeLessThan(0);
    expect(compareThreadPosition(reply(5, 'b'), reply(5, 'a'))).toBeGreaterThan(0);
  });

  it('is 0 for the same position', () => {
    expect(compareThreadPosition(msg(5, 1n), msg(5, 1n))).toBe(0);
  });

  it('sorts a late redelivery at its original place (AC-15)', () => {
    const items = [msg(10, 5n), reply(11, 'r'), msg(3, 2n)];
    items.sort(compareThreadPosition);
    expect(items.map((i) => i.id)).toEqual([2n, 5n, 'r']);
  });
});

describe('compareThreadPosition with activity (AC-09)', () => {
  it('orders message < reply < activity at equal positions', () => {
    const items = [activity(5, 'a'), reply(5, 'r'), msg(5, 1n)];
    items.sort(compareThreadPosition);
    expect(items.map((i) => i.kind)).toEqual(['message', 'reply', 'activity']);
    expect(compareThreadPosition(reply(5, 'z'), activity(5, 'a'))).toBeLessThan(0);
    expect(compareThreadPosition(activity(5, 'a'), msg(5, 9n))).toBeGreaterThan(0);
  });

  it('orders activity by time before kind', () => {
    expect(compareThreadPosition(activity(4, 'a'), msg(5, 1n))).toBeLessThan(0);
  });

  it('breaks activity ties by id', () => {
    expect(compareThreadPosition(activity(5, 'a'), activity(5, 'b'))).toBeLessThan(0);
    expect(compareThreadPosition(activity(5, 'b'), activity(5, 'a'))).toBeGreaterThan(0);
    expect(compareThreadPosition(activity(5, 'a'), activity(5, 'a'))).toBe(0);
  });
});

describe('thread cursor', () => {
  it('round-trips an activity position', () => {
    const p: ThreadPosition = { positionAt: t(5, 7), kind: 'activity', id: '0190a1b2-c3d4' };
    expect(decodeThreadCursor(encodeThreadCursor(p))).toEqual(p);
  });

  it('still decodes cursors issued before the deploy (message / reply)', () => {
    const old = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const at = t(5, 123).getTime();
    expect(decodeThreadCursor(old({ k: 't', at, kind: 'message', id: '42' }))).toEqual({
      positionAt: t(5, 123),
      kind: 'message',
      id: 42n,
    });
    expect(decodeThreadCursor(old({ k: 't', at, kind: 'reply', id: 'r-1' }))).toEqual({
      positionAt: t(5, 123),
      kind: 'reply',
      id: 'r-1',
    });
  });

  it('rejects an unknown kind and an empty activity id', () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const at = t(5).getTime();
    expect(decodeThreadCursor(enc({ k: 't', at, kind: 'note', id: 'x' }))).toBeNull();
    expect(decodeThreadCursor(enc({ k: 't', at, kind: 'activity', id: '' }))).toBeNull();
  });

  it('round-trips a message position', () => {
    const c = encodeThreadCursor(msg(5, 123456789012n));
    const back = decodeThreadCursor(c);
    expect(back).toEqual(msg(5, 123456789012n));
  });

  it('round-trips a reply position with millisecond precision', () => {
    const p: ThreadPosition = { positionAt: t(5, 123), kind: 'reply', id: 'abc-123' };
    expect(decodeThreadCursor(encodeThreadCursor(p))).toEqual(p);
  });

  it('produces an opaque base64url string, at most 200 chars', () => {
    const c = encodeThreadCursor(reply(5, '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'));
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.length).toBeLessThanOrEqual(200);
  });

  it.each(['', '!!!', 'not a cursor', 'AAAA', 'e30', Buffer.from('{"x":1}').toString('base64url')])(
    'rejects malformed cursor %j',
    (bad) => {
      expect(decodeThreadCursor(bad)).toBeNull();
    },
  );

  it('rejects a list cursor presented as a thread cursor', () => {
    expect(decodeThreadCursor(encodeListCursor({ lastActivityAt: t(1), id: 'x' }))).toBeNull();
  });
});

describe('list cursor', () => {
  it('round-trips (last_activity_at, id)', () => {
    const v = { lastActivityAt: t(7, 42), id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' };
    const c = encodeListCursor(v);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.length).toBeLessThanOrEqual(200);
    expect(decodeListCursor(c)).toEqual(v);
  });

  it.each(['', '!!!', 'garbage', Buffer.from('[]').toString('base64url')])(
    'rejects malformed cursor %j',
    (bad) => {
      expect(decodeListCursor(bad)).toBeNull();
    },
  );

  it('rejects a thread cursor presented as a list cursor', () => {
    expect(decodeListCursor(encodeThreadCursor(msg(1, 1n)))).toBeNull();
  });

  const v = { lastActivityAt: t(7, 42), id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' };
  const lens = { status: 'closed', assignee: 'mine', q: 'Олена' } as const;

  it('binds the cursor to the lenses and the search it was issued for', () => {
    const c = encodeListCursor(v, lens);
    expect(c.length).toBeLessThanOrEqual(200);
    expect(decodeListCursor(c, lens)).toEqual(v);
    expect(decodeListCursor(c, { ...lens, status: 'open' })).toBeNull();
    expect(decodeListCursor(c, { ...lens, assignee: 'all' })).toBeNull();
    expect(decodeListCursor(c, { ...lens, q: 'other' })).toBeNull();
    expect(decodeListCursor(c)).toBeNull();
  });

  it('a cursor without lens fields is the open, all, no-search cursor', () => {
    const old = Buffer.from(
      JSON.stringify({ k: 'l', at: v.lastActivityAt.getTime(), id: v.id }),
    ).toString('base64url');
    expect(decodeListCursor(old)).toEqual(v);
    expect(decodeListCursor(old, lens)).toBeNull();
    expect(decodeListCursor(encodeListCursor(v))).toEqual(v);
  });
});
