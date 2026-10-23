import { createHash } from 'node:crypto';

// Opaque keyset cursors of the Contacts list and the tag history. A list cursor is bound to the
// search and the filter it was issued for (a short digest), like the inbox list cursor.

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decode(cursor: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 200) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 9999-12-31T23:59:59.999Z: a cursor time is a message or history time, never outside 1970 .. 9999. */
const MAX_CURSOR_MS = 253_402_300_799_999;

/** A time in range, so a crafted cursor never reaches Postgres as a timestamp it cannot hold. */
function toDate(ms: unknown): Date | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > MAX_CURSOR_MS) return null;
  return new Date(ms);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid, so a crafted cursor never fails the database's uuid cast (a 500 instead of a 400). */
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** What a list cursor is valid for: the normalised search, the mode and the resolved tag ids (any order). */
export function contactFilterKey(f: {
  q: string | null;
  mode: string;
  tagIds: readonly string[];
}): string {
  const text = JSON.stringify([f.q ?? '', f.mode, [...new Set(f.tagIds)].sort()]);
  return createHash('sha256').update(text).digest('base64url').slice(0, 16);
}

export interface ContactCursorPosition {
  /** null = the tail of contacts that never wrote. */
  lastWroteAt: Date | null;
  id: string;
}

export function encodeContactCursor(p: ContactCursorPosition, filterKey: string): string {
  return encode({
    k: 'c',
    at: p.lastWroteAt === null ? null : p.lastWroteAt.getTime(),
    id: p.id,
    f: filterKey,
  });
}

/** Null when malformed or issued for another search or filter. */
export function decodeContactCursor(
  cursor: string,
  filterKey: string,
): ContactCursorPosition | null {
  const o = decode(cursor);
  if (!o || o.k !== 'c' || o.f !== filterKey || !isId(o.id)) return null;
  if (o.at === null) return { lastWroteAt: null, id: o.id };
  const lastWroteAt = toDate(o.at);
  return lastWroteAt ? { lastWroteAt, id: o.id } : null;
}

export interface HistoryCursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeHistoryCursor(p: HistoryCursorPosition): string {
  return encode({ k: 'h', at: p.createdAt.getTime(), id: p.id });
}

export function decodeHistoryCursor(cursor: string): HistoryCursorPosition | null {
  const o = decode(cursor);
  if (!o || o.k !== 'h' || !isId(o.id)) return null;
  const createdAt = toDate(o.at);
  return createdAt ? { createdAt, id: o.id } : null;
}
