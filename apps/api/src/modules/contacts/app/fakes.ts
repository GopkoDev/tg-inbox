import { newId } from '../../../platform/ids.js';
import { shouldRefreshProfile } from '../domain/profile.js';
import { CONTACTS_PAGE_SIZE, TAG_HISTORY_PAGE_SIZE } from '../domain/tags.js';
import {
  normalizeSearchQuery,
  type ContactListFilter,
  type ContactListQuery,
  type ContactRecord,
  type ContactRepo,
  type ContactTagRepo,
  type TagHistoryRepo,
  type TagHistoryRow,
  type TagRepo,
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
      tags.push({ id, workspaceId, name });
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
