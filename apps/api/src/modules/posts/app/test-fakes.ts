import type { Db } from '../../../platform/db.js';
import type { DestinationRecord } from '../infra/destination-repo.js';
import type { PostRecord } from '../infra/post-repo.js';

export interface FakeStore {
  posts: PostRecord[];
  destinations: DestinationRecord[];
  signals: string[];
  /** Members (active) as `${ws}:${account}`. */
  active: Set<string>;
}

export function fakeStore(): FakeStore {
  return { posts: [], destinations: [], signals: [], active: new Set() };
}

/** In-memory subset of the real `PostRepo` (same method names and null-on-miss semantics). */
export function fakePostRepo(s: FakeStore) {
  const get = (ws: string, id: string) => s.posts.find((p) => p.workspaceId === ws && p.id === id);
  return {
    async insertDraft(
      ws: string,
      d: {
        id: string;
        destinationId: string | null;
        text: string;
        silent: boolean;
        authorAccountId: string;
        createdAt: Date;
      },
    ): Promise<PostRecord> {
      const p = basePost({ ...d, workspaceId: ws });
      s.posts.push(p);
      return { ...p };
    },
    async find(ws: string, id: string) {
      const p = get(ws, id);
      return p ? { ...p } : null;
    },
    async lock(ws: string, id: string) {
      const p = get(ws, id);
      return p ? { ...p } : null;
    },
    async saveDraft(
      ws: string,
      id: string,
      expectedVersion: number,
      patch: { text?: string; silent?: boolean; destinationId?: string | null },
      by: string,
      at: Date,
    ) {
      const p = get(ws, id);
      if (!p || p.state !== 'draft' || p.version !== expectedVersion) return null;
      if (patch.text !== undefined) p.text = patch.text;
      if (patch.silent !== undefined) p.silent = patch.silent;
      if (patch.destinationId !== undefined) p.destinationId = patch.destinationId;
      p.version += 1;
      p.lastChangedByAccountId = by;
      p.lastChangedAt = at;
      p.draftNotice = null;
      return { ...p };
    },
    async returnToDraft(
      ws: string,
      id: string,
      notice: PostRecord['draftNotice'],
      by: string,
      at: Date,
    ) {
      const p = get(ws, id);
      if (!p || p.state !== 'scheduled') return null;
      Object.assign(p, {
        state: 'draft',
        version: p.version + 1,
        draftNotice: notice,
        scheduledFor: null,
        scheduledByAccountId: null,
        scheduleKind: null,
        lastChangedByAccountId: by,
        lastChangedAt: at,
      });
      return { ...p };
    },
    async markDeleted(ws: string, id: string, by: string, at: Date) {
      const p = get(ws, id);
      if (!p || p.state !== 'published') return null;
      Object.assign(p, {
        state: 'deleted',
        deletedAt: at,
        deletedByAccountId: by,
        lastChangedByAccountId: by,
        lastChangedAt: at,
      });
      return { ...p };
    },
    async scheduledByAccount(ws: string, accountId: string) {
      return s.posts
        .filter(
          (p) =>
            p.workspaceId === ws && p.state === 'scheduled' && p.scheduledByAccountId === accountId,
        )
        .map((p) => ({ ...p }));
    },
    async clearAttention(ws: string, id: string) {
      const p = get(ws, id);
      if (!p || !p.needsAttention) return false;
      p.needsAttention = false;
      return true;
    },
    async countAttention(ws: string) {
      return s.posts.filter((p) => p.workspaceId === ws && p.needsAttention).length;
    },
    async list(ws: string, filter: { state?: PostRecord['state'] }) {
      return s.posts
        .filter((p) => p.workspaceId === ws && (!filter.state || p.state === filter.state))
        .sort((a, b) => b.lastChangedAt.getTime() - a.lastChangedAt.getTime())
        .map((p) => ({ ...p }));
    },
    async remove(ws: string, id: string) {
      const i = s.posts.findIndex(
        (p) => p.workspaceId === ws && p.id === id && p.state === 'draft',
      );
      if (i < 0) return false;
      s.posts.splice(i, 1);
      return true;
    },
  };
}

export function fakeDestinationRepo(s: FakeStore) {
  return {
    async find(ws: string, id: string) {
      const d = s.destinations.find((x) => x.workspaceId === ws && x.id === id && !x.removedAt);
      return d ? { ...d } : null;
    },
  };
}

export function fakeTransaction() {
  const tx = {} as Db;
  return async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => fn(tx);
}

export function basePost(o: Partial<PostRecord> & { id: string; workspaceId: string }): PostRecord {
  const at = o.createdAt ?? new Date('2026-11-01T09:00:00Z');
  return {
    destinationId: null,
    text: '',
    silent: false,
    state: 'draft',
    version: 1,
    authorAccountId: 'a',
    lastChangedByAccountId: o.authorAccountId ?? 'a',
    lastChangedAt: at,
    createdAt: at,
    scheduledFor: null,
    scheduledByAccountId: null,
    scheduleKind: null,
    sendingStartedAt: null,
    publishedAt: null,
    telegramMessageId: null,
    outcomeReason: null,
    outcomeAt: null,
    needsAttention: false,
    draftNotice: null,
    deletedAt: null,
    deletedByAccountId: null,
    ...o,
  };
}

export function basePostDestination(
  o: Partial<DestinationRecord> & { id: string; workspaceId: string },
): DestinationRecord {
  return {
    telegramBotId: 1n,
    chatId: -1001234567890n,
    kind: 'channel',
    title: 'Acme Flowers News',
    username: null,
    availability: 'available',
    problem: null,
    membershipChangedAt: new Date('2026-11-01T08:00:00Z'),
    connectedByAccountId: 'a',
    connectedAt: new Date('2026-11-01T08:00:00Z'),
    removedAt: null,
    removedByAccountId: null,
    pausedUntil: null,
    nextSendAt: null,
    ...o,
  };
}
