import { newId } from '../../../platform/ids.js';
import { shouldRefreshProfile } from '../domain/profile.js';
import { tagNameKey } from '../domain/tag-name.js';
import { CONTACTS_PAGE_SIZE, mergeLink, TAG_HISTORY_PAGE_SIZE } from '../domain/tags.js';
import {
  normalizeSearchQuery,
  type ContactListFilter,
  type ContactListQuery,
  type ContactRecord,
  type ContactRepo,
  type ContactTagRepo,
  type TagHistoryRepo,
  type Executor,
  type TagHistoryRow,
  type TagRecord,
  type TagRepo,
  type TagSignals,
} from './ports.js';

/** In-memory ContactRepo for unit tests; applies the same profile-refresh rule as the SQL. */
export function fakeContactRepo(): ContactRepo & { rows: ContactRecord[] } {
  const rows: ContactRecord[] = [];
  return {
    rows,
    async upsertFromProfile(workspaceId, profile, seenAt, now) {
      const existing = rows.find(
        (r) => r.workspaceId === workspaceId && r.telegramUserId === profile.telegramUserId,
      );
      if (!existing) {
        const id = newId();
        rows.push({
          ...profile,
          id,
          workspaceId,
          profileSeenAt: seenAt,
          createdAt: now,
          firstWroteAt: seenAt,
          lastWroteAt: seenAt,
        });
        return { contactId: id, created: true };
      }
      const t = seenAt.getTime();
      if (existing.firstWroteAt === null || t < existing.firstWroteAt.getTime())
        existing.firstWroteAt = seenAt;
      if (existing.lastWroteAt === null || t > existing.lastWroteAt.getTime())
        existing.lastWroteAt = seenAt;
      if (shouldRefreshProfile(existing.profileSeenAt, seenAt)) {
        Object.assign(existing, profile, { profileSeenAt: seenAt });
      }
      return { contactId: existing.id, created: false };
    },
    async count(workspaceId) {
      return rows.filter((r) => r.workspaceId === workspaceId).length;
    },
    async searchContactIds(workspaceId, query) {
      const q = normalizeSearchQuery(query)?.toLowerCase();
      if (q === undefined) return null;
      return rows
        .filter((r) => r.workspaceId === workspaceId)
        .filter(
          (r) =>
            `${r.firstName} ${r.lastName ?? ''}`.toLowerCase().includes(q) ||
            (r.username?.toLowerCase().includes(q) ?? false),
        )
        .map((r) => r.id)
        .sort();
    },
    async profile(workspaceId, contactId) {
      const row = rows.find((r) => r.workspaceId === workspaceId && r.id === contactId);
      return row ? { ...row } : null;
    },
    async lockContact(workspaceId, contactId) {
      return rows.some((r) => r.workspaceId === workspaceId && r.id === contactId);
    },
    async contactsByIds(workspaceId, ids) {
      return rows
        .filter((r) => r.workspaceId === workspaceId && ids.includes(r.id))
        .map((r) => ({
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          username: r.username,
        }));
    },
  };
}

// ───────── tags and the Contacts reads ─────────

interface FakeTag {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  createdBy: string;
  createdAt: Date;
}
interface FakeLink {
  workspaceId: string;
  contactId: string;
  tagId: string;
  addedBy: string;
  addedAt: Date;
}
interface FakeHistory extends TagHistoryRow {
  workspaceId: string;
  contactId: string;
}

const collator = new Intl.Collator('und', { sensitivity: 'base' });

/** In-memory tags, links and history shared by the read fakes below; `addTag` returns the tag id. */
export function fakeTagStore() {
  const tags: FakeTag[] = [];
  const links: FakeLink[] = [];
  const entries: FakeHistory[] = [];
  return {
    tags,
    links,
    entries,
    addTag(workspaceId: string, name: string): string {
      const id = newId();
      tags.push({
        id,
        workspaceId,
        name,
        key: tagNameKey(name),
        createdBy: newId(),
        createdAt: new Date(0),
      });
      return id;
    },
    renameTag(workspaceId: string, id: string, name: string) {
      const tag = tags.find((t) => t.workspaceId === workspaceId && t.id === id);
      if (tag) tag.name = name;
    },
    link(workspaceId: string, contactId: string, tagId: string, addedBy: string, addedAt: Date) {
      links.push({ workspaceId, contactId, tagId, addedBy, addedAt });
    },
    history(workspaceId: string, contactId: string, e: Omit<TagHistoryRow, 'id'>) {
      entries.push({ ...e, id: newId(), workspaceId, contactId });
    },
  };
}
export type FakeTagStore = ReturnType<typeof fakeTagStore>;

/**
 * The read-side ports of `createContactReads` over in-memory rows: the list query applies the same
 * rules as the SQL (search via the contact fake, any / all / none, keyset with the NULL tail).
 */
export function fakeReadPorts(
  contactRepo: ReturnType<typeof fakeContactRepo>,
  store: FakeTagStore,
) {
  const tagOrder = (a: FakeTag, b: FakeTag) => collator.compare(a.name, b.name);
  const tagsOfContact = (ws: string, contactId: string) =>
    store.links
      .filter((l) => l.workspaceId === ws && l.contactId === contactId)
      .map((l) => ({
        link: l,
        tag: store.tags.find((t) => t.workspaceId === ws && t.id === l.tagId)!,
      }))
      .sort((x, y) => tagOrder(x.tag, y.tag));

  async function matching(ws: string, f: ContactListFilter): Promise<ContactRecord[]> {
    const ids = [...new Set(f.tagIds)];
    const searched = await contactRepo.searchContactIds(ws, f.q ?? '');
    return contactRepo.rows.filter((c) => {
      if (c.workspaceId !== ws) return false;
      if (searched !== null && !searched.includes(c.id)) return false;
      const carried = new Set(tagsOfContact(ws, c.id).map((x) => x.tag.id));
      if (f.mode === 'none') return carried.size === 0;
      if (ids.length === 0) return true;
      return f.mode === 'any'
        ? ids.some((id) => carried.has(id))
        : ids.every((id) => carried.has(id));
    });
  }

  const lists: ContactListQuery = {
    async listPage(ws, f) {
      const all = (await matching(ws, f)).sort((a, b) => {
        if (a.lastWroteAt === null || b.lastWroteAt === null) {
          if (a.lastWroteAt !== b.lastWroteAt) return a.lastWroteAt === null ? 1 : -1;
        } else if (a.lastWroteAt.getTime() !== b.lastWroteAt.getTime()) {
          return b.lastWroteAt.getTime() - a.lastWroteAt.getTime();
        }
        return a.id < b.id ? 1 : -1;
      });
      let start = 0;
      if (f.after) {
        const { lastWroteAt, id } = f.after;
        start = all.findIndex((c) =>
          lastWroteAt === null
            ? c.lastWroteAt === null && c.id < id
            : c.lastWroteAt === null ||
              c.lastWroteAt.getTime() < lastWroteAt.getTime() ||
              (c.lastWroteAt.getTime() === lastWroteAt.getTime() && c.id < id),
        );
        if (start === -1) start = all.length;
      }
      const slice = all.slice(start, start + CONTACTS_PAGE_SIZE + 1);
      return {
        rows: slice.slice(0, CONTACTS_PAGE_SIZE).map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          username: c.username,
          languageCode: c.languageCode,
          firstWroteAt: c.firstWroteAt,
          lastWroteAt: c.lastWroteAt,
          tags: tagsOfContact(ws, c.id).map((x) => ({ id: x.tag.id, name: x.tag.name })),
        })),
        hasNext: slice.length > CONTACTS_PAGE_SIZE,
      };
    },
    async matchingCount(ws, f) {
      return (await matching(ws, f)).length;
    },
    async totalCount(ws) {
      return contactRepo.rows.filter((c) => c.workspaceId === ws).length;
    },
  };

  const tags: Pick<TagRepo, 'resolveIds'> = {
    async resolveIds(ws, ids) {
      return store.tags.filter((t) => t.workspaceId === ws && ids.includes(t.id)).map((t) => t.id);
    },
  };

  const contactTags: Pick<ContactTagRepo, 'tagsOf'> = {
    async tagsOf(ws, contactId) {
      return tagsOfContact(ws, contactId).map(({ link, tag }) => ({
        tagId: tag.id,
        name: tag.name,
        addedByAccountId: link.addedBy,
        addedAt: link.addedAt,
      }));
    },
  };

  const tagHistory: Pick<TagHistoryRepo, 'page'> = {
    async page(ws, contactId, after) {
      const sorted = store.entries
        .filter((e) => e.workspaceId === ws && e.contactId === contactId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .filter(
          (e) =>
            !after ||
            e.createdAt.getTime() < after.createdAt.getTime() ||
            (e.createdAt.getTime() === after.createdAt.getTime() && e.id < after.id),
        );
      const entries = sorted.slice(0, TAG_HISTORY_PAGE_SIZE).map((e): TagHistoryRow => ({
        id: e.id,
        tagId: e.tagId,
        tagName: e.tagName,
        kind: e.kind,
        mergedInto: e.mergedInto,
        actorAccountId: e.actorAccountId,
        source: e.source,
        createdAt: e.createdAt,
      }));
      return { entries, hasNext: sorted.length > TAG_HISTORY_PAGE_SIZE };
    },
  };

  return { lists, tags, contactTags, tagHistory };
}

// ───────── tag writes ─────────

const recordOf = (t: FakeTag): TagRecord => ({
  id: t.id,
  workspaceId: t.workspaceId,
  name: t.name,
  key: t.key,
  createdByAccountId: t.createdBy,
  createdAt: t.createdAt,
});

/**
 * The write-side ports of the tag use cases over the same store: a transaction that restores the
 * store when its function throws (a refusal leaves nothing behind), and the signals as a log.
 */
export function fakeTagWritePorts(
  contactRepo: ReturnType<typeof fakeContactRepo>,
  store: FakeTagStore,
) {
  const tx = {} as Executor;
  const signalLog: string[] = [];
  const events: string[] = [];
  const order = (a: FakeTag, b: FakeTag) =>
    collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);
  const countOf = (ws: string, tagId: string) =>
    store.links.filter((l) => l.workspaceId === ws && l.tagId === tagId).length;
  const tagOf = (ws: string, id: string) =>
    store.tags.find((t) => t.workspaceId === ws && t.id === id);

  const tags: TagRepo = {
    async lockWorkspaceTags() {
      events.push('lock:tags');
    },
    async findByKey(ws, key) {
      const t = store.tags.find((x) => x.workspaceId === ws && x.key === key);
      return t ? recordOf(t) : null;
    },
    async count(ws) {
      return store.tags.filter((t) => t.workspaceId === ws).length;
    },
    async insert(ws, tag) {
      if (store.tags.some((t) => t.workspaceId === ws && t.key === tag.key)) {
        throw new Error('duplicate tag key');
      }
      const row = {
        id: tag.id,
        workspaceId: ws,
        name: tag.name,
        key: tag.key,
        createdBy: tag.createdBy,
        createdAt: tag.createdAt,
      };
      store.tags.push(row);
      return recordOf(row);
    },
    async listWithCounts(ws) {
      return store.tags
        .filter((t) => t.workspaceId === ws)
        .sort(order)
        .map((t) => ({ id: t.id, name: t.name, contactCount: countOf(ws, t.id) }));
    },
    async countFor(ws, id) {
      return countOf(ws, id);
    },
    async resolveIds(ws, ids) {
      return store.tags.filter((t) => t.workspaceId === ws && ids.includes(t.id)).map((t) => t.id);
    },
    async lockForKeyShare(ws, id) {
      events.push('lock:key-share');
      const t = tagOf(ws, id);
      return t ? recordOf(t) : null;
    },
    async lockForUpdate(ws, ids) {
      events.push('lock:for-update');
      return store.tags
        .filter((t) => t.workspaceId === ws && ids.includes(t.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(recordOf);
    },
    async rename(ws, id, name, key) {
      const t = tagOf(ws, id);
      if (!t) return false;
      t.name = name;
      t.key = key;
      return true;
    },
    async delete(ws, id) {
      if (countOf(ws, id) > 0) throw new Error('tag still has links');
      const i = store.tags.findIndex((t) => t.workspaceId === ws && t.id === id);
      if (i === -1) return false;
      store.tags.splice(i, 1);
      return true;
    },
  };

  const linksOf = (ws: string, contactId: string) =>
    store.links
      .filter((l) => l.workspaceId === ws && l.contactId === contactId)
      .map((l) => ({ link: l, tag: tagOf(ws, l.tagId)! }))
      .sort((a, b) => order(a.tag, b.tag));

  const contactTags: ContactTagRepo = {
    async tagsOf(ws, contactId) {
      return linksOf(ws, contactId).map(({ link, tag }) => ({
        tagId: tag.id,
        name: tag.name,
        addedByAccountId: link.addedBy,
        addedAt: link.addedAt,
      }));
    },
    async tagsOfMany(ws, contactIds) {
      const out = new Map<string, { id: string; name: string }[]>();
      for (const id of contactIds) {
        const rows = linksOf(ws, id);
        if (rows.length)
          out.set(
            id,
            rows.map((r) => ({ id: r.tag.id, name: r.tag.name })),
          );
      }
      return out;
    },
    async carries(ws, contactId, tagId) {
      return store.links.some(
        (l) => l.workspaceId === ws && l.contactId === contactId && l.tagId === tagId,
      );
    },
    async countFor(ws, contactId) {
      return store.links.filter((l) => l.workspaceId === ws && l.contactId === contactId).length;
    },
    async insert(link) {
      store.link(link.workspaceId, link.contactId, link.tagId, link.addedByAccountId, link.addedAt);
    },
    async delete(ws, contactId, tagId) {
      const i = store.links.findIndex(
        (l) => l.workspaceId === ws && l.contactId === contactId && l.tagId === tagId,
      );
      if (i === -1) return false;
      store.links.splice(i, 1);
      return true;
    },
    async mergeInto(ws, fromId, toId) {
      if (fromId === toId) throw new Error('cannot merge a tag into itself');
      const carriers = store.links.filter((l) => l.workspaceId === ws && l.tagId === fromId);
      const contactIds = carriers.map((l) => l.contactId);
      for (const from of carriers) {
        const target = store.links.find(
          (l) => l.workspaceId === ws && l.contactId === from.contactId && l.tagId === toId,
        );
        if (target) {
          const kept = mergeLink(
            { addedAt: from.addedAt, addedBy: from.addedBy },
            { addedAt: target.addedAt, addedBy: target.addedBy },
          );
          target.addedAt = kept.addedAt;
          target.addedBy = kept.addedBy;
          store.links.splice(store.links.indexOf(from), 1);
        } else {
          from.tagId = toId;
        }
      }
      return contactIds;
    },
    async deleteLinksReturning(ws, tagId) {
      const gone = store.links.filter((l) => l.workspaceId === ws && l.tagId === tagId);
      for (const l of gone) store.links.splice(store.links.indexOf(l), 1);
      return gone.map((l) => l.contactId);
    },
  };

  const memberKinds = ['added', 'removed'];
  const tagHistory: TagHistoryRepo = {
    ...fakeReadPorts(contactRepo, store).tagHistory,
    async append(e) {
      const id = newId();
      store.entries.push({
        id,
        workspaceId: e.workspaceId,
        contactId: e.contactId,
        tagId: e.tagId,
        tagName: e.tagName,
        kind: e.kind,
        mergedInto: null,
        actorAccountId: e.actorAccountId,
        source: e.source,
        createdAt: e.createdAt,
      });
      return id;
    },
    async memberChangesSince(ws, accountId, since) {
      const mine = store.entries
        .filter(
          (e) =>
            e.workspaceId === ws &&
            e.actorAccountId === accountId &&
            memberKinds.includes(e.kind) &&
            e.createdAt.getTime() > since.getTime(),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { count: mine.length, oldestAt: mine[0]?.createdAt ?? null };
    },
    async appendMerged(ws, contactIds, from, to, actor, now) {
      for (const contactId of contactIds) {
        store.history(ws, contactId, {
          tagId: from.id,
          tagName: from.name,
          kind: 'merged',
          mergedInto: { tagId: to.id, name: to.name },
          actorAccountId: actor,
          source: 'settings',
          createdAt: now,
        });
      }
    },
    async appendDeleted(ws, contactIds, tag, actor, now) {
      for (const contactId of contactIds) {
        store.history(ws, contactId, {
          tagId: tag.id,
          tagName: tag.name,
          kind: 'deleted',
          mergedInto: null,
          actorAccountId: actor,
          source: 'settings',
          createdAt: now,
        });
      }
    },
    async lockMemberChanges() {
      events.push('lock:member-changes');
    },
  };

  const signals: TagSignals = {
    async contactChanged(_tx, ws, contactId) {
      signalLog.push(`contact.changed:${ws}:${contactId}`);
    },
    async tagsChanged(_tx, ws) {
      signalLog.push(`tags.changed:${ws}`);
    },
  };

  /** Signals of a rolled-back transaction are dropped with the rest. */
  async function transaction<T>(fn: (t: Executor) => Promise<T>): Promise<T> {
    const snapshot = {
      tags: store.tags.map((t) => ({ ...t })),
      links: store.links.map((l) => ({ ...l })),
      entries: store.entries.map((e) => ({ ...e })),
      signals: [...signalLog],
    };
    try {
      return await fn(tx);
    } catch (e) {
      store.tags.splice(0, store.tags.length, ...snapshot.tags);
      store.links.splice(0, store.links.length, ...snapshot.links);
      store.entries.splice(0, store.entries.length, ...snapshot.entries);
      signalLog.splice(0, signalLog.length, ...snapshot.signals);
      throw e;
    }
  }

  return { tags, contactTags, tagHistory, signals, transaction, signalLog, events };
}
