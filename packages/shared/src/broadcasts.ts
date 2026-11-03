import { z } from 'zod';
import { BROADCAST_NAME_MAX, BROADCAST_TEXT_MAX, broadcastTextLength } from './broadcast-text.js';
import { TagFilterMode, TagName, TagRef } from './contacts.js';
import { Cursor, MemberRef } from './inbox.js';

// Wire shapes of the broadcasts feature (docs/features/broadcasts/contracts/openapi.yaml).

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();
const Version = z.int().min(1).max(2147483647);
const Count = z.int().min(0).max(2147483647);
const AUDIENCE_MAX = 10000;
const GroupSize = z.int().min(0).max(AUDIENCE_MAX);

// ───────── constants and names ─────────

/** The tidied name; the 1–80 grapheme bound is checked by `checkBroadcastName` (graphemes). */
export const BroadcastName = z.string().min(1);
export type BroadcastName = z.infer<typeof BroadcastName>;

/** Trimmed, at most 4096 UTF-16 code units (ADR-0012); empty only in a draft with no text yet. */
export const BroadcastText = z
  .string()
  .refine((t) => broadcastTextLength(t) <= BROADCAST_TEXT_MAX, {
    message: `at most ${BROADCAST_TEXT_MAX} UTF-16 code units`,
  });
export type BroadcastText = z.infer<typeof BroadcastText>;

/** A text that is sent or about to be: never empty. */
const SentText = BroadcastText.refine((t) => t.length > 0, { message: 'never empty' });

/** The name as typed; the server tidies it and checks 1–80 graphemes (`BROADCAST_NAME_INVALID`). */
export const RawBroadcastName = z.string().max(1000);
export type RawBroadcastName = z.infer<typeof RawBroadcastName>;

/** The text as typed; the server trims it and checks 1–4096 UTF-16 units (`BROADCAST_TEXT_INVALID`). */
export const RawBroadcastText = z.string().max(20000);
export type RawBroadcastText = z.infer<typeof RawBroadcastText>;

export const BroadcastStatus = z.enum(['draft', 'sending', 'sent', 'stopped']);
export type BroadcastStatus = z.infer<typeof BroadcastStatus>;

export const LaunchedStatus = z.enum(['sending', 'sent', 'stopped']);
export type LaunchedStatus = z.infer<typeof LaunchedStatus>;

export const AudienceKind = z.enum(['tags', 'group']);
export type AudienceKind = z.infer<typeof AudienceKind>;

export const AudienceTagKind = z.enum(['include', 'exclude']);
export type AudienceTagKind = z.infer<typeof AudienceTagKind>;

export const EndReason = z.enum(['completed', 'text_refused', 'bot_stopped', 'stopped']);
export type EndReason = z.infer<typeof EndReason>;

export const RecipientState = z.enum([
  'waiting',
  'sending',
  'delivered',
  'blocked',
  'failed',
  'not_confirmed',
  'stopped',
]);
export type RecipientState = z.infer<typeof RecipientState>;

export const RecipientFailureReason = z.enum([
  'account_gone',
  'chat_not_found',
  'telegram_error',
  'text_refused',
  'bot_stopped',
]);
export type RecipientFailureReason = z.infer<typeof RecipientFailureReason>;

/** SHA-256 (lowercase hex) over the sorted reachable contact ids the confirmation counted (ADR-0006). */
export const AudienceFingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export type AudienceFingerprint = z.infer<typeof AudienceFingerprint>;

// ───────── audience and breakdown ─────────

export const AudienceTag = z.strictObject({ tag_id: Id, name: TagName, kind: AudienceTagKind });
export type AudienceTag = z.infer<typeof AudienceTag>;

export const DraftTagAudience = z.strictObject({
  kind: z.literal('tags'),
  mode: TagFilterMode,
  tags: z.array(AudienceTag).max(200),
  dropped_tags: z.array(AudienceTag).max(200),
});
export type DraftTagAudience = z.infer<typeof DraftTagAudience>;

export const DraftGroupAudience = z.strictObject({ kind: z.literal('group'), size: GroupSize });
export type DraftGroupAudience = z.infer<typeof DraftGroupAudience>;

export const DraftAudience = z.discriminatedUnion('kind', [DraftTagAudience, DraftGroupAudience]);
export type DraftAudience = z.infer<typeof DraftAudience>;

export const LaunchedTagAudience = z.strictObject({
  kind: z.literal('tags'),
  mode: TagFilterMode,
  tags: z.array(AudienceTag).max(200),
});
export const LaunchedGroupAudience = z.strictObject({ kind: z.literal('group') });
export const LaunchedAudience = z.discriminatedUnion('kind', [
  LaunchedTagAudience,
  LaunchedGroupAudience,
]);
export type LaunchedAudience = z.infer<typeof LaunchedAudience>;

/** A draft's count breakdown for the current Telegram bot; `reach` is null with no bot row. */
export const DraftBreakdown = z
  .strictObject({
    audience_size: Count,
    reach: z
      .strictObject({ blocked_count: Count, never_wrote_count: Count, reachable_count: Count })
      .nullable(),
  })
  .refine(
    (b) =>
      b.reach === null ||
      b.audience_size ===
        b.reach.blocked_count + b.reach.never_wrote_count + b.reach.reachable_count,
    { message: 'the breakdown adds up', path: ['audience_size'] },
  );
export type DraftBreakdown = z.infer<typeof DraftBreakdown>;

/** The breakdown a launch confirmation shows, frozen on the broadcast at launch. */
export const LaunchBreakdown = z
  .strictObject({
    audience_size: Count,
    blocked_count: Count,
    never_wrote_count: Count,
    recipient_count: Count,
  })
  .refine((b) => b.audience_size === b.blocked_count + b.never_wrote_count + b.recipient_count, {
    message: 'the breakdown adds up',
    path: ['audience_size'],
  });
export type LaunchBreakdown = z.infer<typeof LaunchBreakdown>;

export const RecipientTotals = z.strictObject({
  waiting: Count,
  sending: Count,
  delivered: Count,
  blocked: Count,
  failed: Count,
  not_confirmed: Count,
  stopped: Count,
});
export type RecipientTotals = z.infer<typeof RecipientTotals>;

// ───────── broadcasts ─────────

export const BroadcastListItem = z.strictObject({
  id: Id,
  name: BroadcastName,
  status: BroadcastStatus,
  audience_kind: AudienceKind,
  audience_size: Count,
  author: MemberRef,
  last_changed_by: MemberRef,
  last_changed_at: DateTime,
  launched_at: DateTime.nullable(),
  ended_at: DateTime.nullable(),
});
export type BroadcastListItem = z.infer<typeof BroadcastListItem>;

export const BroadcastList = z.strictObject({
  workspace_id: Id,
  items: z.array(BroadcastListItem),
});
export type BroadcastList = z.infer<typeof BroadcastList>;

const broadcastFields = {
  id: Id,
  workspace_id: Id,
  name: BroadcastName,
  author: MemberRef,
  last_changed_by: MemberRef,
  last_changed_at: DateTime,
  created_at: DateTime,
};

export const BroadcastDraft = z.strictObject({
  ...broadcastFields,
  status: z.literal('draft'),
  version: Version,
  text: BroadcastText,
  audience: DraftAudience,
  breakdown: DraftBreakdown,
});
export type BroadcastDraft = z.infer<typeof BroadcastDraft>;

export const LaunchedBroadcast = z
  .strictObject({
    ...broadcastFields,
    status: LaunchedStatus,
    text: SentText,
    audience: LaunchedAudience,
    launched_by: MemberRef,
    launched_at: DateTime,
    launch_breakdown: LaunchBreakdown,
    stopped_by: MemberRef.nullable(),
    stopped_at: DateTime.nullable(),
    ended_at: DateTime.nullable(),
    end_reason: EndReason.nullable(),
    totals: RecipientTotals,
    not_reached_count: Count,
  })
  .refine(
    (b) =>
      (b.status === 'stopped') === (b.stopped_by !== null) &&
      (b.stopped_by === null) === (b.stopped_at === null),
    { message: 'stopped_by and stopped_at are set exactly when stopped', path: ['stopped_by'] },
  )
  .refine(
    (b) =>
      (b.status === 'sending') === (b.ended_at === null) &&
      (b.ended_at === null) === (b.end_reason === null) &&
      (b.end_reason === null || (b.status === 'stopped') === (b.end_reason === 'stopped')),
    { message: 'an ended broadcast has its end time and reason', path: ['end_reason'] },
  );
export type LaunchedBroadcast = z.infer<typeof LaunchedBroadcast>;

export const Broadcast = z.discriminatedUnion('status', [BroadcastDraft, LaunchedBroadcast]);
export type Broadcast = z.infer<typeof Broadcast>;

// ───────── group ─────────

export const GroupContactCard = z.strictObject({
  id: Id,
  first_name: z.string(),
  last_name: z.string().nullable(),
  username: z.string().nullable(),
  tags: z.array(TagRef).max(20),
  blocked_since: DateTime.nullable(),
});
export type GroupContactCard = z.infer<typeof GroupContactCard>;

export const BroadcastGroupRow = z.strictObject({
  contact: GroupContactCard,
  added_by: MemberRef,
  added_at: DateTime,
});
export type BroadcastGroupRow = z.infer<typeof BroadcastGroupRow>;

export const BroadcastGroupPage = z.strictObject({
  workspace_id: Id,
  broadcast_id: Id,
  size: GroupSize,
  items: z.array(BroadcastGroupRow).max(50),
  has_prev: z.boolean(),
  has_next: z.boolean(),
  next_cursor: Cursor.nullable(),
});
export type BroadcastGroupPage = z.infer<typeof BroadcastGroupPage>;

export const BroadcastGroupMembership = z.strictObject({
  broadcast_id: Id,
  contact_ids: z.array(Id).max(50),
});
export type BroadcastGroupMembership = z.infer<typeof BroadcastGroupMembership>;

export const BroadcastGroupAdd = z.strictObject({ contact_id: Id });
export type BroadcastGroupAdd = z.infer<typeof BroadcastGroupAdd>;

export const BroadcastGroupChange = z.strictObject({
  broadcast_id: Id,
  outcome: z.enum(['added', 'removed', 'unchanged']),
  group_size: GroupSize,
});
export type BroadcastGroupChange = z.infer<typeof BroadcastGroupChange>;

export const BroadcastGroupMatching = z.strictObject({
  broadcast_id: Id,
  matching_count: Count,
  already_in_group_count: Count,
  to_add_count: Count,
  can_add: GroupSize,
  missing_tag_ids: z.array(Id).max(100),
});
export type BroadcastGroupMatching = z.infer<typeof BroadcastGroupMatching>;

const NO_TAGS_WITH_TAGS = '"No tags" cannot be combined with chosen tags';

export const BroadcastGroupAddMatching = z
  .strictObject({
    q: z.string().max(200).nullable().optional(),
    mode: TagFilterMode,
    tag_ids: z.array(Id).max(100),
    expected_count: GroupSize,
  })
  .superRefine((body, ctx) => {
    if (body.mode === 'none' && body.tag_ids.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['tag_ids'], message: NO_TAGS_WITH_TAGS });
    }
  });
export type BroadcastGroupAddMatching = z.infer<typeof BroadcastGroupAddMatching>;

export const BroadcastGroupMatchingAdded = z.strictObject({
  broadcast_id: Id,
  expected_count: Count,
  added_count: Count,
  group_size: GroupSize,
});
export type BroadcastGroupMatchingAdded = z.infer<typeof BroadcastGroupMatchingAdded>;

// ───────── requests ─────────

export const BroadcastCreate = z.strictObject({
  name: RawBroadcastName,
  text: RawBroadcastText.optional(),
});
export type BroadcastCreate = z.infer<typeof BroadcastCreate>;

export const BroadcastFieldsSave = z
  .strictObject({
    expected_version: Version,
    name: RawBroadcastName.optional(),
    text: RawBroadcastText.optional(),
  })
  .refine((b) => b.name !== undefined || b.text !== undefined, {
    message: 'at least one of name and text',
    path: ['name'],
  });
export type BroadcastFieldsSave = z.infer<typeof BroadcastFieldsSave>;

const unique = (ids: string[]) => new Set(ids).size === ids.length;

export const TagAudienceSave = z
  .strictObject({
    expected_version: Version,
    kind: z.literal('tags'),
    mode: TagFilterMode,
    tag_ids: z.array(Id).max(100).refine(unique, { message: 'a tag is named once' }),
    exclude_tag_ids: z.array(Id).max(100).refine(unique, { message: 'a tag is named once' }),
    expected_group_size: GroupSize.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === 'none' && (body.tag_ids.length > 0 || body.exclude_tag_ids.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tag_ids'],
        message: '"No tags" cannot be combined with chosen or left-out tags',
      });
      return;
    }
    const chosen = new Set(body.tag_ids);
    if (body.exclude_tag_ids.some((t) => chosen.has(t))) {
      ctx.addIssue({
        code: 'custom',
        path: ['exclude_tag_ids'],
        message: 'A tag cannot be both chosen and left out',
      });
    }
  });
export type TagAudienceSave = z.infer<typeof TagAudienceSave>;

export const GroupAudienceSave = z.strictObject({
  expected_version: Version,
  kind: z.literal('group'),
});
export type GroupAudienceSave = z.infer<typeof GroupAudienceSave>;

export const BroadcastAudienceSave = z.discriminatedUnion('kind', [
  TagAudienceSave,
  GroupAudienceSave,
]);
export type BroadcastAudienceSave = z.infer<typeof BroadcastAudienceSave>;

export const DuplicateAudience = z.enum(['same', 'same_tags', 'all_recipients', 'not_reached']);
export type DuplicateAudience = z.infer<typeof DuplicateAudience>;

export const BroadcastDuplicate = z.strictObject({
  audience: DuplicateAudience,
  include_not_confirmed: z.boolean().default(false),
});
export type BroadcastDuplicate = z.infer<typeof BroadcastDuplicate>;

export const BroadcastLaunch = z.strictObject({
  expected_version: Version,
  fingerprint: AudienceFingerprint,
});
export type BroadcastLaunch = z.infer<typeof BroadcastLaunch>;

// ───────── answers ─────────

export const LaunchConfirmation = z.strictObject({
  broadcast_id: Id,
  version: Version,
  name: BroadcastName,
  text: SentText,
  breakdown: LaunchBreakdown,
  fingerprint: AudienceFingerprint,
});
export type LaunchConfirmation = z.infer<typeof LaunchConfirmation>;

export const BroadcastLaunched = z.strictObject({
  outcome: z.enum(['launched', 'already_launched']),
  broadcast: LaunchedBroadcast,
});
export type BroadcastLaunched = z.infer<typeof BroadcastLaunched>;

export const BroadcastStopped = z.strictObject({
  outcome: z.enum(['stopped', 'unchanged']),
  broadcast: Broadcast,
});
export type BroadcastStopped = z.infer<typeof BroadcastStopped>;

export const BroadcastDeleted = z.strictObject({ workspace_id: Id, broadcast_id: Id });
export type BroadcastDeleted = z.infer<typeof BroadcastDeleted>;

export const RecipientContact = z.strictObject({
  id: Id,
  first_name: z.string(),
  last_name: z.string().nullable(),
  username: z.string().nullable(),
});
export type RecipientContact = z.infer<typeof RecipientContact>;

const IN_FLIGHT: RecipientState[] = ['waiting', 'sending'];

export const BroadcastRecipient = z
  .strictObject({
    id: Id,
    position: z.int().min(1).max(AUDIENCE_MAX),
    contact: RecipientContact,
    state: RecipientState,
    failure_reason: RecipientFailureReason.nullable(),
    outcome_at: DateTime.nullable(),
  })
  .refine((r) => (r.state === 'failed') === (r.failure_reason !== null), {
    message: 'a reason is set exactly when the recipient failed',
    path: ['failure_reason'],
  })
  .refine((r) => IN_FLIGHT.includes(r.state) === (r.outcome_at === null), {
    message: 'an outcome has its time; a waiting or in-flight recipient has none',
    path: ['outcome_at'],
  });
export type BroadcastRecipient = z.infer<typeof BroadcastRecipient>;

export const BroadcastRecipientPage = z.strictObject({
  workspace_id: Id,
  broadcast_id: Id,
  state: RecipientState.nullable(),
  items: z.array(BroadcastRecipient).max(50),
  has_prev: z.boolean(),
  has_next: z.boolean(),
  next_cursor: Cursor.nullable(),
});
export type BroadcastRecipientPage = z.infer<typeof BroadcastRecipientPage>;

// ───────── refusals ─────────

const refusal = <C extends string, D extends z.ZodType>(code: C, details: D) =>
  z.strictObject({
    error: z.strictObject({ code: z.literal(code), message: z.string(), details }),
  });

export const BroadcastNameInvalidError = refusal(
  'BROADCAST_NAME_INVALID',
  z.strictObject({
    field: z.literal('name'),
    min_length: z.literal(1),
    max_length: z.literal(BROADCAST_NAME_MAX),
  }),
);
export const BroadcastTextInvalidError = refusal(
  'BROADCAST_TEXT_INVALID',
  z.strictObject({
    field: z.literal('text'),
    min_length: z.literal(1),
    max_length: z.literal(BROADCAST_TEXT_MAX),
    length: Count,
  }),
);
export const BroadcastDraftChangedError = refusal(
  'BROADCAST_DRAFT_CHANGED',
  z.strictObject({ draft: BroadcastDraft }),
);
export const BroadcastGroupChangedError = refusal(
  'BROADCAST_GROUP_CHANGED',
  z.strictObject({ group_size: GroupSize }),
);
export const BroadcastNotADraftError = refusal(
  'BROADCAST_NOT_A_DRAFT',
  z.strictObject({ broadcast_id: Id, status: LaunchedStatus }),
);
export const BroadcastNotEndedError = refusal(
  'BROADCAST_NOT_ENDED',
  z.strictObject({ broadcast_id: Id, status: z.literal('sending') }),
);
export const BroadcastAudienceChangedError = refusal(
  'BROADCAST_AUDIENCE_CHANGED',
  z.strictObject({ confirmation: LaunchConfirmation }),
);
export const BroadcastAudienceTooLargeError = refusal(
  'BROADCAST_AUDIENCE_TOO_LARGE',
  z.strictObject({ limit: z.literal(AUDIENCE_MAX), audience_size: Count, can_add: GroupSize }),
);
export const BroadcastNoReachableContactError = refusal(
  'BROADCAST_NO_REACHABLE_CONTACT',
  z.strictObject({ breakdown: LaunchBreakdown }),
);
export const BroadcastBotState = z.enum(['not_connected', 'needs_token', 'taken_over']);
export type BroadcastBotState = z.infer<typeof BroadcastBotState>;
export const BroadcastNeedsWorkingBotError = refusal(
  'BROADCAST_NEEDS_WORKING_BOT',
  z.strictObject({ bot_state: BroadcastBotState }),
);
export const BroadcastLaunchLimitReachedError = refusal(
  'BROADCAST_LAUNCH_LIMIT_REACHED',
  z.strictObject({
    limit: z.literal(10),
    window_hours: z.literal(24),
    next_launch_at: DateTime,
  }),
);
