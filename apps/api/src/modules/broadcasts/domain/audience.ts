// A broadcast's audience rules (sad.md §5 domain; AC-01, AC-05, AC-06; ADR-0004, ADR-0006).
import { createHash } from 'node:crypto';

/** Every contact a group holds or a tag audience matches, reachable or not (AC-05). */
export const AUDIENCE_LIMIT = 10_000;

export type TagMode = 'any' | 'all' | 'none';
export type AudienceTagKind = 'include' | 'exclude';

/** Whether an audience of `size` contacts may be launched, and how many can still be added. */
export const checkAudienceSize = (size: number): { ok: boolean; canAdd: number } => ({
  ok: size <= AUDIENCE_LIMIT,
  canAdd: Math.max(0, AUDIENCE_LIMIT - size),
});

/** A bulk add fits as a whole or not at all. */
export const fitsAudience = (current: number, adding: number): boolean =>
  current + adding <= AUDIENCE_LIMIT;

/**
 * A tag audience's shape: a tag is chosen or left out, never both; "no tags" takes neither chosen
 * nor left-out tags (the contract's `VALIDATION_ERROR` fields).
 */
export const checkTagAudience = (o: {
  mode: TagMode;
  include: readonly string[];
  exclude: readonly string[];
}): { ok: true } | { ok: false; field: 'tag_ids' | 'exclude_tag_ids' } => {
  if (o.mode === 'none' && (o.include.length > 0 || o.exclude.length > 0)) {
    return { ok: false, field: 'tag_ids' };
  }
  const chosen = new Set(o.include);
  if (o.exclude.some((t) => chosen.has(t))) return { ok: false, field: 'exclude_tag_ids' };
  return { ok: true };
};

export interface StoredAudienceTag {
  tagId: string;
  /** The name when chosen (`broadcast_audience_tags.tag_name`). */
  name: string;
  kind: AudienceTagKind;
}

/**
 * Splits a draft's stored tags into those that still exist (evaluated) and those deleted or merged
 * away since (left out of the evaluation and named in the notice by their stored name).
 */
export const splitExistingTags = <T extends StoredAudienceTag>(
  stored: readonly T[],
  existingIds: ReadonlySet<string>,
): { kept: T[]; dropped: T[] } => ({
  kept: stored.filter((t) => existingIds.has(t.tagId)),
  dropped: stored.filter((t) => !existingIds.has(t.tagId)),
});

/** SHA-256 (lowercase hex) of the reachable contact ids sorted ascending, one per line (ADR-0006). */
export const audienceFingerprint = (contactIds: readonly string[]): string =>
  createHash('sha256')
    .update([...contactIds].sort().join('\n'))
    .digest('hex');
