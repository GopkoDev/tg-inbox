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
