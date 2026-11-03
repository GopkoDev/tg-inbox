import { z } from 'zod';
import { Cursor, MemberRef } from './inbox.js';

// Wire shapes of the contacts feature (docs/features/contacts/contracts/openapi.yaml).

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();

// ───────── tags ─────────

/** The tidied name; the 1–32 grapheme bound is checked by `checkTagName` (graphemes, not code points). */
export const TagName = z.string().min(1);
export type TagName = z.infer<typeof TagName>;

/** A tag as a contact carries it: a list row, or the tag an add applied. */
export const TagRef = z.strictObject({ id: Id, name: TagName });
export type TagRef = z.infer<typeof TagRef>;

/** A tag on a contact with who added it and when. */
export const ContactTag = z.strictObject({
  id: Id,
  name: TagName,
  added_by: MemberRef,
  added_at: DateTime,
});
export type ContactTag = z.infer<typeof ContactTag>;

export const TagWithCount = z.strictObject({
  id: Id,
  name: TagName,
  contact_count: z.int().min(0).max(2147483647),
});
export type TagWithCount = z.infer<typeof TagWithCount>;

export const TagList = z.strictObject({
  workspace_id: Id,
  items: z.array(TagWithCount).max(100),
});
export type TagList = z.infer<typeof TagList>;

// ───────── contacts ─────────

export const TagFilterMode = z.enum(['any', 'all', 'none']);
export type TagFilterMode = z.infer<typeof TagFilterMode>;

const contactFields = {
  id: Id,
  workspace_id: Id,
  first_name: z.string(),
  last_name: z.string().nullable(),
  username: z.string().nullable(),
  language_code: z.string().nullable(),
  first_wrote_at: DateTime.nullable(),
  last_wrote_at: DateTime.nullable(),
};

/** `contact_bot_reach.blocked_at` for the current Telegram bot; null when not blocked or no bot. */
const BlockedSince = DateTime.nullable();

export const ContactRow = z.strictObject({
  ...contactFields,
  tags: z.array(TagRef).max(20),
  blocked_since: BlockedSince,
});
export type ContactRow = z.infer<typeof ContactRow>;

export const ContactPage = z.strictObject({
  workspace_id: Id,
  filter: z.strictObject({
    q: z.string().nullable(),
    mode: TagFilterMode,
    tag_ids: z.array(Id).max(100),
  }),
  items: z.array(ContactRow).max(50),
  has_prev: z.boolean(),
  has_next: z.boolean(),
  next_cursor: Cursor.nullable(),
  matching_count: z.int().min(0),
  total_count: z.int().min(0),
  missing_tag_ids: z.array(Id).max(100),
});
export type ContactPage = z.infer<typeof ContactPage>;

export const ContactProfile = z.strictObject({
  ...contactFields,
  tags: z.array(ContactTag).max(20),
  blocked_since: BlockedSince,
});
export type ContactProfile = z.infer<typeof ContactProfile>;

/**
 * Query of `listContacts`. `tag` may arrive as one value or repeated; `mode=none` takes no tag
 * (refused with `details.field = tag`).
 */
export const ListContactsQuery = z
  .strictObject({
    q: z.string().max(200).optional(),
    mode: TagFilterMode.default('any'),
    tag: z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(Id).max(100)).optional(),
    after: Cursor.optional(),
  })
  .superRefine((query, ctx) => {
    if (query.mode === 'none' && query.tag !== undefined && query.tag.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['tag'], message: 'mode none takes no tag' });
    }
  });
export type ListContactsQuery = z.infer<typeof ListContactsQuery>;

// ───────── tag history ─────────

export const TagHistoryKind = z.enum(['added', 'removed', 'merged', 'deleted']);
export type TagHistoryKind = z.infer<typeof TagHistoryKind>;

export const TagHistorySource = z.enum(['inbox', 'profile', 'settings']);
export type TagHistorySource = z.infer<typeof TagHistorySource>;

export const TagHistoryEntry = z
  .strictObject({
    id: Id,
    kind: TagHistoryKind,
    tag_id: Id,
    tag_name: z.string().min(1),
    merged_into_tag_id: Id.nullable(),
    merged_into_name: z.string().min(1).nullable(),
    actor: MemberRef,
    source: TagHistorySource,
    created_at: DateTime,
  })
  .refine(
    (e) =>
      (e.kind === 'merged') === (e.merged_into_tag_id !== null) &&
      (e.merged_into_tag_id === null) === (e.merged_into_name === null),
    {
      message: 'a merge entry names its target, no other entry does',
      path: ['merged_into_tag_id'],
    },
  );
export type TagHistoryEntry = z.infer<typeof TagHistoryEntry>;

export const TagHistoryPage = z.strictObject({
  workspace_id: Id,
  contact_id: Id,
  items: z.array(TagHistoryEntry).max(50),
  has_prev: z.boolean(),
  has_next: z.boolean(),
  next_cursor: Cursor.nullable(),
});
export type TagHistoryPage = z.infer<typeof TagHistoryPage>;

// ───────── requests ─────────

/** Where a member acted. `settings` is written by the server on owner paths only. */
export const MemberTagSource = z.enum(['inbox', 'profile']);
export type MemberTagSource = z.infer<typeof MemberTagSource>;

/** The name as typed; the server tidies it and checks 1–32 graphemes (`TAG_NAME_INVALID`). */
export const RawTagName = z.string().min(1).max(1000);
export type RawTagName = z.infer<typeof RawTagName>;

/** Exactly one of `tag_id` (a picked suggestion) and `name` (create). */
export const ContactTagAdd = z.union([
  z.strictObject({ tag_id: Id, source: MemberTagSource }),
  z.strictObject({ name: RawTagName, source: MemberTagSource }),
]);
export type ContactTagAdd = z.infer<typeof ContactTagAdd>;

export const ContactTagRemove = z.strictObject({ source: MemberTagSource });
export type ContactTagRemove = z.infer<typeof ContactTagRemove>;

export const TagRename = z.strictObject({
  name: RawTagName,
  merge_into_tag_id: Id.optional(),
});
export type TagRename = z.infer<typeof TagRename>;

export const TagDelete = z.strictObject({ expected_count: z.int().min(0).max(2147483647) });
export type TagDelete = z.infer<typeof TagDelete>;

// ───────── answers ─────────

export const ChangeOutcome = z.enum(['recorded', 'unchanged']);
export type ChangeOutcome = z.infer<typeof ChangeOutcome>;

export const ContactTagAdded = z.strictObject({
  workspace_id: Id,
  contact_id: Id,
  outcome: ChangeOutcome,
  tag: TagRef,
  tag_created: z.boolean(),
  tags: z.array(ContactTag).max(20),
});
export type ContactTagAdded = z.infer<typeof ContactTagAdded>;

export const ContactTagRemoved = z.strictObject({
  workspace_id: Id,
  contact_id: Id,
  outcome: ChangeOutcome,
  tags: z.array(ContactTag).max(20),
});
export type ContactTagRemoved = z.infer<typeof ContactTagRemoved>;

export const TagRenameResult = z.strictObject({
  workspace_id: Id,
  outcome: z.enum(['renamed', 'merged', 'unchanged']),
  tag: TagWithCount,
  merged_tag_id: Id.nullable(),
});
export type TagRenameResult = z.infer<typeof TagRenameResult>;

export const TagDeleted = z.strictObject({
  workspace_id: Id,
  tag_id: Id,
  removed_from_count: z.int().min(0),
});
export type TagDeleted = z.infer<typeof TagDeleted>;

// ───────── refusals ─────────

const refusal = <C extends string, D extends z.ZodType>(code: C, details: D) =>
  z.strictObject({
    error: z.strictObject({ code: z.literal(code), message: z.string(), details }),
  });

export const TagNameInvalidError = refusal(
  'TAG_NAME_INVALID',
  z.strictObject({ field: z.literal('name'), min_length: z.literal(1), max_length: z.literal(32) }),
);
export const TagLimitReachedError = refusal(
  'TAG_LIMIT_REACHED',
  z.strictObject({ limit: z.literal(100) }),
);
export const ContactTagLimitReachedError = refusal(
  'CONTACT_TAG_LIMIT_REACHED',
  z.strictObject({ limit: z.literal(20) }),
);
export const TagNotFoundError = refusal('TAG_NOT_FOUND', z.strictObject({ tag_id: Id }));
export const TagNameTakenError = refusal('TAG_NAME_TAKEN', z.strictObject({ tag: TagWithCount }));
export const TagMergeTargetChangedError = refusal(
  'TAG_MERGE_TARGET_CHANGED',
  z.strictObject({ name_holder: TagWithCount.nullable() }),
);
export const TagCountChangedError = refusal(
  'TAG_COUNT_CHANGED',
  z.strictObject({ tag: TagWithCount }),
);
export const TagChangeLimitReachedError = refusal(
  'TAG_CHANGE_LIMIT_REACHED',
  z.strictObject({
    limit: z.literal(60),
    window_seconds: z.literal(60),
    retry_at: DateTime,
  }),
);
