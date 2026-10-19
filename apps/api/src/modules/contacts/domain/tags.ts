// Pure tag rules: the limits, the history kinds and sources, the merge link rule and the rate-limit
// retry time. The use cases enforce them under their locks (ADR-0004); nothing here does I/O.

export const TAGS_PER_WORKSPACE = 100;
export const TAGS_PER_CONTACT = 20;
export const TAG_CHANGES_PER_WINDOW = 60;
export const TAG_CHANGE_WINDOW_MS = 60_000;
export const CONTACTS_PAGE_SIZE = 50;
export const TAG_HISTORY_PAGE_SIZE = 50;

/** A workspace may create another tag while it holds fewer than 100 (AC-08). */
export const canCreateTag = (tagCount: number): boolean => tagCount < TAGS_PER_WORKSPACE;

/** A contact may take another tag while it carries fewer than 20 (AC-08). */
export const canAddToContact = (carried: number): boolean => carried < TAGS_PER_CONTACT;

export type RateLimitDecision =
  { allowed: true } | { allowed: false; retryAt: Date; retryAfterSeconds: number };

/**
 * The member's tag-change budget (AC-15): `countedInWindow` is their `added` / `removed` entries of
 * the last 60 s, `oldestCountedAt` the oldest of them. At the limit, the member can continue when
 * the oldest counted entry leaves the window; `retryAfterSeconds` is that wait rounded up, 1–60.
 */
export function rateLimitDecision(
  countedInWindow: number,
  oldestCountedAt: Date | null,
  now: Date,
): RateLimitDecision {
  if (countedInWindow < TAG_CHANGES_PER_WINDOW || oldestCountedAt === null) {
    return { allowed: true };
  }
  const retryAt = new Date(oldestCountedAt.getTime() + TAG_CHANGE_WINDOW_MS);
  const seconds = Math.ceil((retryAt.getTime() - now.getTime()) / 1000);
  return {
    allowed: false,
    retryAt,
    retryAfterSeconds: Math.min(60, Math.max(1, seconds)),
  };
}

export const MEMBER_KINDS = ['added', 'removed'] as const;
export const OWNER_KINDS = ['merged', 'deleted'] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];
export type OwnerKind = (typeof OWNER_KINDS)[number];
export type TagHistoryKind = MemberKind | OwnerKind;
export type TagHistorySource = 'inbox' | 'profile' | 'settings';

/** Member kinds come from the member routes (inbox / profile), owner kinds only from Settings. */
export function sourceIsValidFor(kind: TagHistoryKind, source: TagHistorySource): boolean {
  return (MEMBER_KINDS as readonly string[]).includes(kind)
    ? source === 'inbox' || source === 'profile'
    : source === 'settings';
}

export interface TagLink {
  addedAt: Date;
  addedBy: string;
}

/**
 * The link a contact holds on the merge target afterwards (AC-09): the merged link re-pointed
 * unchanged when the contact carried only the merged tag, otherwise the earlier of the two
 * additions (the target's on a tie).
 */
export function mergeLink(mergedLink: TagLink, targetLink: TagLink | null): TagLink {
  if (targetLink === null) return mergedLink;
  return mergedLink.addedAt.getTime() < targetLink.addedAt.getTime() ? mergedLink : targetLink;
}

export interface OwnerHistoryEntry {
  contactId: string;
  tagId: string;
  tagName: string;
  kind: OwnerKind;
  mergedInto: { tagId: string; name: string } | null;
  actorAccountId: string;
  source: 'settings';
  createdAt: Date;
}

interface OwnerEntryInput {
  contactId: string;
  tagId: string;
  tagName: string;
  actorAccountId: string;
  createdAt: Date;
}

/** One entry per contact that carried the merged tag (name snapshots of both tags). */
export function mergedEntryFor(
  o: OwnerEntryInput & { mergedInto: { tagId: string; name: string } },
): OwnerHistoryEntry {
  return { ...pick(o), kind: 'merged', mergedInto: o.mergedInto, source: 'settings' };
}

/** One entry per contact that lost the deleted tag. */
export function deletedEntryFor(o: OwnerEntryInput): OwnerHistoryEntry {
  return { ...pick(o), kind: 'deleted', mergedInto: null, source: 'settings' };
}

const pick = (o: OwnerEntryInput) => ({
  contactId: o.contactId,
  tagId: o.tagId,
  tagName: o.tagName,
  actorAccountId: o.actorAccountId,
  createdAt: o.createdAt,
});
