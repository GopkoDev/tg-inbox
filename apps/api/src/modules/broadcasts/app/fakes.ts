import type { BroadcastDraft } from '@tg/shared';
import { isNotReached, type RecipientState } from '../domain/recipient.js';
import type {
  AudienceSpec,
  AudienceTagRepo,
  AudienceTagRow,
  BotsApi,
  BroadcastChange,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  ContactCard,
  ContactsApi,
  DraftView,
  Executor,
  GroupRepo,
  GroupRow,
  RecipientRecord,
  RecipientRepo,
  RecipientTotals,
  Transaction,
  WorkspacesApi,
} from './ports.js';

/** In-memory broadcasts rows shared by the repository fakes below (one workspace or many). */
export function fakeBroadcastStore() {
  const broadcasts: BroadcastRecord[] = [];
  const tags: (AudienceTagRow & { workspaceId: string; broadcastId: string })[] = [];
  const group: (GroupRow & { workspaceId: string; broadcastId: string })[] = [];
  const recipients: (RecipientRecord & { workspaceId: string })[] = [];
  const signals: string[] = [];
  return { broadcasts, tags, group, recipients, signals };
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
      recipients: s.recipients.map((r) => ({ ...r })),
      signals: [...s.signals],
    };
    try {
      return await fn(tx);
    } catch (e) {
      s.broadcasts.splice(0, s.broadcasts.length, ...snapshot.broadcasts);
      s.tags.splice(0, s.tags.length, ...snapshot.tags);
      s.group.splice(0, s.group.length, ...snapshot.group);
      s.recipients.splice(0, s.recipients.length, ...snapshot.recipients);
      s.signals.splice(0, s.signals.length, ...snapshot.signals);
      throw e;
    }
  };
}

/** A contact as the `contacts` fake holds it: its tags and its reach per Telegram bot. */
export interface FakeContact {
  id: string;
  firstName: string;
  tagIds: string[];
  /** Telegram bot ids it wrote to. */
  wroteTo?: bigint[];
  /** Telegram bot id → when it blocked that bot. */
  blocked?: Map<bigint, Date>;
}

/**
 * The workspace's tags and contacts (`contacts`): `tags` is (workspace → id → current name),
 * `contacts` (workspace → contacts). The audience follows the Contacts filter's rules: a gone tag is
 * left out, "any" / "all" of the chosen tags (none chosen = everyone), "none" = no tags, and a
 * contact with any left-out tag is never counted; partitioned blocked, never wrote, reachable.
 */
export function fakeContactsApi(): ContactsApi & {
  tags: Map<string, Map<string, string>>;
  contacts: Map<string, FakeContact[]>;
} {
  const tags = new Map<string, Map<string, string>>();
  const contacts = new Map<string, FakeContact[]>();
  const own = (ws: string) => tags.get(ws) ?? new Map<string, string>();
  const members = (ws: string, audience: AudienceSpec): FakeContact[] => {
    const all = contacts.get(ws) ?? [];
    if (audience.kind === 'ids') {
      const ids = new Set(audience.contactIds);
      return all.filter((c) => ids.has(c.id));
    }
    const include = audience.include.filter((id) => own(ws).has(id));
    const exclude = audience.exclude.filter((id) => own(ws).has(id));
    return all.filter((c) => {
      if (c.tagIds.some((t) => exclude.includes(t))) return false;
      if (audience.mode === 'none') return c.tagIds.length === 0;
      if (include.length === 0) return true;
      return audience.mode === 'any'
        ? include.some((t) => c.tagIds.includes(t))
        : include.every((t) => c.tagIds.includes(t));
    });
  };
  return {
    tags,
    contacts,
    async resolveTags(workspaceId, tagIds) {
      return tagIds
        .filter((id) => own(workspaceId).has(id))
        .map((id) => ({ id, name: own(workspaceId).get(id)! }));
    },
    async reachableContacts(workspaceId, audience, telegramBotId, limit = 10_001) {
      return members(workspaceId, audience)
        .filter((c) => !c.blocked?.has(telegramBotId) && c.wroteTo?.includes(telegramBotId))
        .map((c) => ({ id: c.id, telegramUserId: BigInt(`0x${c.id.slice(-8)}`) }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit);
    },
    async matchingContactIds(workspaceId, filter) {
      const q = (filter.q ?? '').trim().toLowerCase();
      return members(workspaceId, {
        kind: 'tags',
        mode: filter.mode,
        include: filter.tagIds,
        exclude: [],
      })
        .filter((c) => q === '' || c.firstName.toLowerCase().includes(q))
        .map((c) => c.id)
        .sort();
    },
    async audienceBreakdown(workspaceId, audience, telegramBotId) {
      const found = members(workspaceId, audience);
      if (telegramBotId === null) return { audienceSize: found.length, reach: null };
      const blocked = found.filter((c) => c.blocked?.has(telegramBotId)).length;
      const reachable = found.filter(
        (c) => !c.blocked?.has(telegramBotId) && c.wroteTo?.includes(telegramBotId),
      ).length;
      return {
        audienceSize: found.length,
        reach: { blocked, neverWrote: found.length - blocked - reachable, reachable },
      };
    },
    async contactCards(workspaceId, contactIds, telegramBotId): Promise<ContactCard[]> {
      const all = contacts.get(workspaceId) ?? [];
      return contactIds.flatMap((id) => {
        const c = all.find((x) => x.id === id);
        if (!c) return [];
        return [
          {
            id: c.id,
            firstName: c.firstName,
            lastName: null,
            username: null,
            tags: c.tagIds
              .filter((t) => own(workspaceId).has(t))
              .map((t) => ({ id: t, name: own(workspaceId).get(t)! })),
            blockedSince: telegramBotId === null ? null : (c.blocked?.get(telegramBotId) ?? null),
          },
        ];
      });
    },
  };
}

/** `workspaces.lockActiveMembers`: `active` holds `<ws>:<account>`; `locks` logs each call. */
export function fakeWorkspacesApi(): WorkspacesApi & {
  active: Set<string>;
  locks: string[];
  names: Map<string, string>;
} {
  const active = new Set<string>();
  const locks: string[] = [];
  /** `<ws>:<account>` → display name; kept after a deactivation (only `active` changes). */
  const names = new Map<string, string>();
  return {
    active,
    locks,
    names,
    async lockActiveMembers(_tx, workspaceId, accountIds) {
      locks.push(`members:${accountIds.join(',')}`);
      return accountIds.filter((a) => active.has(`${workspaceId}:${a}`));
    },
    async displayNames(workspaceId, accountIds) {
      return new Map(
        accountIds.flatMap((a) => {
          const name = names.get(`${workspaceId}:${a}`);
          return name === undefined ? [] : [[a, name] as [string, string]];
        }),
      );
    },
  };
}

/** `bots.launchReadiness`: the workspace's bot row, or none. */
export function fakeBotsApi(): BotsApi & {
  bots: Map<
    string,
    { state: 'connected' | 'needs_token' | 'taken_over' | 'disconnected'; telegramBotId: bigint }
  >;
} {
  const bots = new Map<
    string,
    { state: 'connected' | 'needs_token' | 'taken_over' | 'disconnected'; telegramBotId: bigint }
  >();
  return {
    bots,
    async launchReadiness(workspaceId) {
      const bot = bots.get(workspaceId);
      return bot ? { ...bot } : null;
    },
  };
}

const ALL_STATES: readonly RecipientState[] = [
  'waiting',
  'sending',
  'delivered',
  'blocked',
  'failed',
  'not_confirmed',
  'stopped',
];

/** `RecipientRepo` over the store, with the SQL's state guards. */
export function fakeRecipientRepo(s: FakeBroadcastStore): RecipientRepo {
  const of = (ws: string, broadcastId: string) =>
    s.recipients
      .filter((r) => r.workspaceId === ws && r.broadcastId === broadcastId)
      .sort((a, b) => a.position - b.position);
  const one = (ws: string, id: string) =>
    s.recipients.find((r) => r.workspaceId === ws && r.id === id);
  const strip = (r: RecipientRecord & { workspaceId: string }): RecipientRecord => {
    const copy: Partial<typeof r> = { ...r };
    delete copy.workspaceId;
    return copy as RecipientRecord;
  };
  const contactIds = (rows: RecipientRecord[]) => rows.map((r) => r.contactId).sort();
  return {
    async insertAll(workspaceId, broadcastId, rows) {
      s.recipients.push(
        ...rows.map((r) => ({
          ...r,
          workspaceId,
          broadcastId,
          state: 'waiting' as const,
          failureReason: null,
          claimedAt: null,
          outcomeAt: null,
          telegramMessageId: null,
        })),
      );
    },
    async claim(workspaceId, id, at) {
      const r = one(workspaceId, id);
      if (!r || r.state !== 'waiting') return false;
      r.state = 'sending';
      r.claimedAt = at;
      return true;
    },
    async recordOutcome(workspaceId, id, outcome, at) {
      const r = one(workspaceId, id);
      if (!r) return false;
      if (!(r.state === 'sending' || (r.state === 'waiting' && outcome.state === 'blocked'))) {
        return false;
      }
      r.state = outcome.state;
      r.failureReason = outcome.state === 'failed' ? outcome.reason : null;
      r.telegramMessageId = outcome.state === 'delivered' ? outcome.telegramMessageId : null;
      r.outcomeAt = at;
      return true;
    },
    async backToWaiting(workspaceId, id) {
      const r = one(workspaceId, id);
      if (!r || r.state !== 'sending') return false;
      r.state = 'waiting';
      r.claimedAt = null;
      return true;
    },
    async resolveStaleInFlight(workspaceId, broadcastIds, at) {
      return s.recipients
        .filter(
          (r) =>
            r.workspaceId === workspaceId &&
            broadcastIds.includes(r.broadcastId) &&
            r.state === 'sending',
        )
        .map((r) => {
          r.state = 'not_confirmed';
          r.outcomeAt = at;
          return {
            id: r.id,
            broadcastId: r.broadcastId,
            contactId: r.contactId,
            claimedAt: r.claimedAt!,
          };
        });
    },
    async settleWaiting(workspaceId, broadcastId, settlement, at) {
      const waiting = of(workspaceId, broadcastId).filter((r) => r.state === 'waiting');
      for (const r of waiting) {
        r.state = settlement.state;
        r.failureReason = settlement.state === 'failed' ? settlement.reason : null;
        r.outcomeAt = at;
      }
      return waiting.length;
    },
    async totals(workspaceId, broadcastId) {
      const totals = Object.fromEntries(ALL_STATES.map((st) => [st, 0])) as RecipientTotals;
      for (const r of of(workspaceId, broadcastId)) totals[r.state] += 1;
      return totals;
    },
    async page(workspaceId, broadcastId, q, limit) {
      const rows = of(workspaceId, broadcastId).filter(
        (r) =>
          (q.after === undefined || r.position > q.after) &&
          (q.state === undefined || r.state === q.state),
      );
      return { rows: rows.slice(0, limit).map(strip), hasNext: rows.length > limit };
    },
    async nextWaiting(workspaceId, broadcastId) {
      const r = of(workspaceId, broadcastId).find((x) => x.state === 'waiting');
      return r ? strip(r) : null;
    },
    async hasWaitingOrInFlight(workspaceId, broadcastId) {
      return of(workspaceId, broadcastId).some(
        (r) => r.state === 'waiting' || r.state === 'sending',
      );
    },
    async allContactIds(workspaceId, broadcastId) {
      return contactIds(of(workspaceId, broadcastId));
    },
    async notReachedContactIds(workspaceId, broadcastId, includeNotConfirmed) {
      return contactIds(
        of(workspaceId, broadcastId).filter((r) => isNotReached(r, includeNotConfirmed)),
      );
    },
    async notReachedCount(workspaceId, broadcastId) {
      return of(workspaceId, broadcastId).filter((r) => isNotReached(r, false)).length;
    },
    async deliveredContactIds(workspaceId, broadcastId) {
      return contactIds(of(workspaceId, broadcastId).filter((r) => r.state === 'delivered'));
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
