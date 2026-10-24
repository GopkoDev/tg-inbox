import type { BroadcastDraft } from '@tg/shared';
import type {
  AudienceTagRepo,
  AudienceTagRow,
  BroadcastChange,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  ContactsApi,
  DraftView,
  Executor,
  GroupRepo,
  GroupRow,
  Transaction,
  WorkspacesApi,
} from './ports.js';

/** In-memory broadcasts rows shared by the repository fakes below (one workspace or many). */
export function fakeBroadcastStore() {
  const broadcasts: BroadcastRecord[] = [];
  const tags: (AudienceTagRow & { workspaceId: string; broadcastId: string })[] = [];
  const group: (GroupRow & { workspaceId: string; broadcastId: string })[] = [];
  const signals: string[] = [];
  return { broadcasts, tags, group, signals };
}
export type FakeBroadcastStore = ReturnType<typeof fakeBroadcastStore>;

const find = (s: FakeBroadcastStore, ws: string, id: string) =>
  s.broadcasts.find((b) => b.workspaceId === ws && b.id === id) ?? null;

/** `BroadcastRepo` over the store; `saveFields` applies the same draft-and-version guard as the SQL. */
export function fakeBroadcastRepo(s: FakeBroadcastStore): BroadcastRepo & { locks: string[] } {
  const locks: string[] = [];
  const copy = (b: BroadcastRecord | null) => (b ? { ...b } : null);
  return {
    locks,
    async insertDraft(workspaceId, d) {
      const row: BroadcastRecord = {
        id: d.id,
        workspaceId,
        name: d.name,
        text: d.text,
        status: 'draft',
        version: 1,
        audienceKind: d.audienceKind,
        tagMode: d.tagMode,
        authorAccountId: d.authorAccountId,
        lastChangedByAccountId: d.authorAccountId,
        lastChangedAt: d.createdAt,
        createdAt: d.createdAt,
        launchedAt: null,
        launchedByAccountId: null,
        launchTelegramBotId: null,
        audienceSize: null,
        blockedCount: null,
        neverWroteCount: null,
        recipientCount: null,
        stoppedAt: null,
        stoppedByAccountId: null,
        endedAt: null,
        endReason: null,
      };
      s.broadcasts.push(row);
      return { ...row };
    },
    async find(workspaceId, id) {
      return copy(find(s, workspaceId, id));
    },
    async lockForUpdate(workspaceId, id) {
      locks.push(`broadcast:${id}`);
      return copy(find(s, workspaceId, id));
    },
    async saveFields(workspaceId, id, expectedVersion, fields, actor, at) {
      const row = find(s, workspaceId, id);
      if (!row || row.status !== 'draft' || row.version !== expectedVersion) return null;
      if (fields.name !== undefined) row.name = fields.name;
      if (fields.text !== undefined) row.text = fields.text;
      if (fields.audienceKind !== undefined) row.audienceKind = fields.audienceKind;
      if (fields.tagMode !== undefined) row.tagMode = fields.tagMode;
      row.version += 1;
      row.lastChangedByAccountId = actor;
      row.lastChangedAt = at;
      return { ...row };
    },
    async touch(workspaceId, id, actor, at) {
      const row = find(s, workspaceId, id);
      if (!row) return false;
      row.lastChangedByAccountId = actor;
      row.lastChangedAt = at;
      return true;
    },
    async list(workspaceId) {
      return s.broadcasts
        .filter((b) => b.workspaceId === workspaceId)
        .sort(
          (a, b) => b.lastChangedAt.getTime() - a.lastChangedAt.getTime() || (a.id < b.id ? 1 : -1),
        )
        .map((b) => ({ ...b }));
    },
    async launchesSince(workspaceId, since) {
      return s.broadcasts.filter(
        (b) => b.workspaceId === workspaceId && b.launchedAt && b.launchedAt >= since,
      ).length;
    },
    async tenthNewestLaunchedAt(workspaceId) {
      const at = s.broadcasts
        .filter((b) => b.workspaceId === workspaceId && b.launchedAt)
        .map((b) => b.launchedAt!)
        .sort((a, b) => b.getTime() - a.getTime());
      return at[9] ?? null;
    },
    async sendingBroadcasts(workspaceId) {
      return s.broadcasts
        .filter((b) => b.workspaceId === workspaceId && b.status === 'sending')
        .sort((a, b) => a.launchedAt!.getTime() - b.launchedAt!.getTime())
        .map((b) => ({ ...b }));
    },
    async deleteDraft(workspaceId, id) {
      const row = find(s, workspaceId, id);
      if (!row || row.status !== 'draft') return false;
      s.broadcasts.splice(s.broadcasts.indexOf(row), 1);
      const keep = <T extends { workspaceId: string; broadcastId: string }>(rows: T[]) =>
        rows.splice(
          0,
          rows.length,
          ...rows.filter((r) => !(r.workspaceId === workspaceId && r.broadcastId === id)),
        );
      keep(s.tags);
      keep(s.group);
      return true;
    },
  };
}

export function fakeAudienceTagRepo(s: FakeBroadcastStore): AudienceTagRepo {
  const of = (ws: string, id: string) =>
    s.tags.filter((t) => t.workspaceId === ws && t.broadcastId === id);
  return {
    async list(workspaceId, broadcastId) {
      return of(workspaceId, broadcastId).map(({ tagId, name, kind }) => ({ tagId, name, kind }));
    },
    async replace(workspaceId, broadcastId, rows) {
      for (const t of of(workspaceId, broadcastId)) s.tags.splice(s.tags.indexOf(t), 1);
      s.tags.push(...rows.map((r) => ({ ...r, workspaceId, broadcastId })));
    },
    async copy(workspaceId, fromId, toId) {
      s.tags.push(...of(workspaceId, fromId).map((t) => ({ ...t, broadcastId: toId })));
    },
  };
}

export function fakeGroupRepo(s: FakeBroadcastStore): GroupRepo {
  const of = (ws: string, id: string) =>
    s.group.filter((g) => g.workspaceId === ws && g.broadcastId === id);
  return {
    async add(workspaceId, broadcastId, contactId, actor, at) {
      if (of(workspaceId, broadcastId).some((g) => g.contactId === contactId)) return false;
      s.group.push({ workspaceId, broadcastId, contactId, addedByAccountId: actor, addedAt: at });
      return true;
    },
    async addMany(workspaceId, broadcastId, contactIds, actor, at) {
      let n = 0;
      for (const contactId of new Set(contactIds)) {
        if (of(workspaceId, broadcastId).some((g) => g.contactId === contactId)) continue;
        s.group.push({ workspaceId, broadcastId, contactId, addedByAccountId: actor, addedAt: at });
        n += 1;
      }
      return n;
    },
    async remove(workspaceId, broadcastId, contactId) {
      const row = of(workspaceId, broadcastId).find((g) => g.contactId === contactId);
      if (!row) return false;
      s.group.splice(s.group.indexOf(row), 1);
      return true;
    },
    async removeAll(workspaceId, broadcastId) {
      const rows = of(workspaceId, broadcastId);
      for (const r of rows) s.group.splice(s.group.indexOf(r), 1);
      return rows.length;
    },
    async membership(workspaceId, broadcastId, contactIds) {
      return of(workspaceId, broadcastId)
        .map((g) => g.contactId)
        .filter((id) => contactIds.includes(id));
    },
    async count(workspaceId, broadcastId) {
      return of(workspaceId, broadcastId).length;
    },
    async ids(workspaceId, broadcastId) {
      return of(workspaceId, broadcastId)
        .map((g) => g.contactId)
        .sort();
    },
    async page(workspaceId, broadcastId, after, limit) {
      const rows = of(workspaceId, broadcastId)
        .sort(
          (a, b) =>
            b.addedAt.getTime() - a.addedAt.getTime() || (a.contactId < b.contactId ? 1 : -1),
        )
        .filter(
          (g) =>
            !after ||
            g.addedAt < after.addedAt ||
            (g.addedAt.getTime() === after.addedAt.getTime() && g.contactId < after.contactId),
        );
      return {
        rows: rows.slice(0, limit).map(({ contactId, addedByAccountId, addedAt }) => ({
          contactId,
          addedByAccountId,
          addedAt,
        })),
        hasNext: rows.length > limit,
      };
    },
  };
}

/** `broadcast.changed` as a log line `<change>:<ws>:<broadcast>`, written into the store. */
export function fakeBroadcastSignals(s: FakeBroadcastStore): BroadcastSignals {
  return {
    async broadcastChanged(_tx, workspaceId, broadcastId, change: BroadcastChange) {
      s.signals.push(`${change}:${workspaceId}:${broadcastId}`);
    },
  };
}

/** A transaction over the store: a throw restores every row and drops its signals. */
export function fakeBroadcastTransaction(s: FakeBroadcastStore): Transaction {
  const tx = {} as Executor;
  return async (fn) => {
    const snapshot = {
      broadcasts: s.broadcasts.map((b) => ({ ...b })),
      tags: s.tags.map((t) => ({ ...t })),
      group: s.group.map((g) => ({ ...g })),
      signals: [...s.signals],
    };
    try {
      return await fn(tx);
    } catch (e) {
      s.broadcasts.splice(0, s.broadcasts.length, ...snapshot.broadcasts);
      s.tags.splice(0, s.tags.length, ...snapshot.tags);
      s.group.splice(0, s.group.length, ...snapshot.group);
      s.signals.splice(0, s.signals.length, ...snapshot.signals);
      throw e;
    }
  };
}

/** The workspace's tags (`contacts`): `tags` is (workspace → id → current name). */
export function fakeContactsApi(): ContactsApi & { tags: Map<string, Map<string, string>> } {
  const tags = new Map<string, Map<string, string>>();
  return {
    tags,
    async resolveTags(workspaceId, tagIds) {
      const own = tags.get(workspaceId) ?? new Map<string, string>();
      return tagIds.filter((id) => own.has(id)).map((id) => ({ id, name: own.get(id)! }));
    },
  };
}

/** `workspaces.lockActiveMembers`: `active` holds `<ws>:<account>`; `locks` logs each call. */
export function fakeWorkspacesApi(): WorkspacesApi & { active: Set<string>; locks: string[] } {
  const active = new Set<string>();
  const locks: string[] = [];
  return {
    active,
    locks,
    async lockActiveMembers(_tx, workspaceId, accountIds) {
      locks.push(`members:${accountIds.join(',')}`);
      return accountIds.filter((a) => active.has(`${workspaceId}:${a}`));
    },
  };
}

/**
 * A stand-in for the draft view `reads` builds (T17): the record and its audience as wire shapes,
 * names = account ids, the breakdown with no bot (`reach: null`).
 */
export function fakeDraftView(s: FakeBroadcastStore): DraftView {
  return {
    async draftView(workspaceId, broadcastId): Promise<BroadcastDraft> {
      const b = find(s, workspaceId, broadcastId);
      if (!b || b.status !== 'draft') throw new Error('no draft');
      const ref = (id: string) => ({ account_id: id, display_name: id });
      const groupSize = s.group.filter(
        (g) => g.workspaceId === workspaceId && g.broadcastId === broadcastId,
      ).length;
      const tags = s.tags
        .filter((t) => t.workspaceId === workspaceId && t.broadcastId === broadcastId)
        .map((t) => ({ tag_id: t.tagId, name: t.name, kind: t.kind }));
      return {
        id: b.id,
        workspace_id: workspaceId,
        name: b.name,
        author: ref(b.authorAccountId),
        last_changed_by: ref(b.lastChangedByAccountId),
        last_changed_at: b.lastChangedAt.toISOString(),
        created_at: b.createdAt.toISOString(),
        status: 'draft',
        version: b.version,
        text: b.text,
        audience:
          b.audienceKind === 'group'
            ? { kind: 'group', size: groupSize }
            : { kind: 'tags', mode: b.tagMode!, tags, dropped_tags: [] },
        breakdown: {
          audience_size: b.audienceKind === 'group' ? groupSize : 0,
          reach: null,
        },
      };
    },
  };
}
