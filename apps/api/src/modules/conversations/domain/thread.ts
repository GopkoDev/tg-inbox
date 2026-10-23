import { createHash } from 'node:crypto';

export type ThreadPosition =
  | { positionAt: Date; kind: 'message'; id: bigint }
  | { positionAt: Date; kind: 'reply'; id: string }
  | { positionAt: Date; kind: 'activity'; id: string }
  | { positionAt: Date; kind: 'broadcast'; id: string };

export interface ListPosition {
  lastActivityAt: Date;
  id: string;
}

/** At equal positions: message < reply < activity < broadcast item (ADR-0010). */
const KIND_ORDER = { message: 0, reply: 1, activity: 2, broadcast: 3 } as const;

export function compareThreadPosition(a: ThreadPosition, b: ThreadPosition): number {
  const dt = a.positionAt.getTime() - b.positionAt.getTime();
  if (dt !== 0) return dt;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.kind === 'message' && b.kind === 'message') return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const x = a.id as string;
  const y = b.id as string;
  return x < y ? -1 : x > y ? 1 : 0;
}

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

function toDate(ms: unknown): Date | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function encodeThreadCursor(p: ThreadPosition): string {
  return encode({ k: 't', at: p.positionAt.getTime(), kind: p.kind, id: String(p.id) });
}

export function decodeThreadCursor(cursor: string): ThreadPosition | null {
  const o = decode(cursor);
  if (!o || o.k !== 't') return null;
  const positionAt = toDate(o.at);
  if (!positionAt || typeof o.id !== 'string' || o.id === '') return null;
  if (o.kind === 'reply') return { positionAt, kind: 'reply', id: o.id };
  if (o.kind === 'activity') return { positionAt, kind: 'activity', id: o.id };
  if (o.kind === 'broadcast') return { positionAt, kind: 'broadcast', id: o.id };
  if (o.kind === 'message' && /^\d+$/.test(o.id)) {
    return { positionAt, kind: 'message', id: BigInt(o.id) };
  }
  return null;
}

export type StatusLens = 'open' | 'closed';
export type AssigneeLens = 'all' | 'mine' | 'unassigned';

/** What a list cursor is valid for: the lenses and the (trimmed) search text it was issued with. */
export interface ListLens {
  status: StatusLens;
  assignee: AssigneeLens;
  q: string;
}

const DEFAULT_LENS: ListLens = { status: 'open', assignee: 'all', q: '' };

/** A short digest, so a long search text never grows the cursor. */
const queryKey = (q: string) => createHash('sha256').update(q).digest('base64url').slice(0, 16);

export function encodeListCursor(p: ListPosition, lens: ListLens = DEFAULT_LENS): string {
  const bound =
    lens.status === 'open' && lens.assignee === 'all' && lens.q === ''
      ? {}
      : { s: lens.status, a: lens.assignee, q: lens.q === '' ? undefined : queryKey(lens.q) };
  return encode({ k: 'l', at: p.lastActivityAt.getTime(), id: p.id, ...bound });
}

/** Null when malformed or issued for other lenses or another search; a lens-less cursor is open · all. */
export function decodeListCursor(
  cursor: string,
  lens: ListLens = DEFAULT_LENS,
): ListPosition | null {
  const o = decode(cursor);
  if (!o || o.k !== 'l') return null;
  const lastActivityAt = toDate(o.at);
  if (!lastActivityAt || typeof o.id !== 'string' || o.id === '') return null;
  if ((o.s ?? 'open') !== lens.status || (o.a ?? 'all') !== lens.assignee) return null;
  if ((o.q ?? '') !== (lens.q === '' ? '' : queryKey(lens.q))) return null;
  return { lastActivityAt, id: o.id };
}
