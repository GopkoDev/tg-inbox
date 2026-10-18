export type ThreadPosition =
  | { positionAt: Date; kind: 'message'; id: bigint }
  | { positionAt: Date; kind: 'reply'; id: string };

export interface ListPosition {
  lastActivityAt: Date;
  id: string;
}

const KIND_ORDER = { message: 0, reply: 1 } as const;

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
  if (o.kind === 'message' && /^\d+$/.test(o.id)) {
    return { positionAt, kind: 'message', id: BigInt(o.id) };
  }
  return null;
}

export function encodeListCursor(p: ListPosition): string {
  return encode({ k: 'l', at: p.lastActivityAt.getTime(), id: p.id });
}

export function decodeListCursor(cursor: string): ListPosition | null {
  const o = decode(cursor);
  if (!o || o.k !== 'l') return null;
  const lastActivityAt = toDate(o.at);
  if (!lastActivityAt || typeof o.id !== 'string' || o.id === '') return null;
  return { lastActivityAt, id: o.id };
}
