// Opaque keyset cursors of the broadcast pages (openapi `Cursor`): base64url JSON, checked on the
// way back in so a crafted cursor is a 400, never a database error.

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

/** The recipients page: the last position shown, bound to the outcome filter it was issued for. */
export function encodeRecipientCursor(position: number, state: string | null): string {
  return encode({ k: 'r', p: position, s: state });
}

/** Null when malformed or issued for another outcome filter. */
export function decodeRecipientCursor(cursor: string, state: string | null): number | null {
  const o = decode(cursor);
  if (!o || o.k !== 'r' || o.s !== state) return null;
  const p = o.p;
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 10_000 ? p : null;
}

/** 9999-12-31T23:59:59.999Z: a cursor time never outside what Postgres holds. */
const MAX_CURSOR_MS = 253_402_300_799_999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The group page: the last row shown, (`added_at`, `contact_id`). */
export function encodeGroupCursor(p: { addedAt: Date; contactId: string }): string {
  return encode({ k: 'g', at: p.addedAt.getTime(), id: p.contactId });
}

/** Null when malformed. */
export function decodeGroupCursor(cursor: string): { addedAt: Date; contactId: string } | null {
  const o = decode(cursor);
  if (!o || o.k !== 'g' || typeof o.id !== 'string' || !UUID.test(o.id)) return null;
  const ms = o.at;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > MAX_CURSOR_MS) return null;
  return { addedAt: new Date(ms), contactId: o.id };
}
