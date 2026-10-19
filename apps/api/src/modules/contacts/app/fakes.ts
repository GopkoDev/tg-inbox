import { newId } from '../../../platform/ids.js';
import { shouldRefreshProfile } from '../domain/profile.js';
import { normalizeSearchQuery, type ContactRecord, type ContactRepo } from './ports.js';

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
