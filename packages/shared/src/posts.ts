import { z } from 'zod';
import { BROADCAST_TEXT_MAX, broadcastTextLength } from './broadcast-text.js';
import { MemberRef } from './inbox.js';

// Wire shapes of the group-posts feature (docs/features/group-posts/contracts/openapi.yaml).

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();
const Version = z.int().min(1).max(2147483647);
const Count = z.int().min(0).max(2147483647);

export const POST_DAILY_LIMIT = 30;
export const POST_SCHEDULED_LIMIT = 100;

export const PostState = z.enum([
  'draft',
  'scheduled',
  'sending',
  'published',
  'failed',
  'missed',
  'not_confirmed',
  'deleted',
]);
export type PostState = z.infer<typeof PostState>;

export const PostOutcomeReason = z.enum([
  'bot_not_working',
  'not_current_bot',
  'destination_unavailable',
  'no_post_right',
  'chat_gone',
  'text_refused',
  'telegram_error',
  'daily_limit',
  'service_down',
  'bot_paused',
  'chat_rate_limited',
]);
export type PostOutcomeReason = z.infer<typeof PostOutcomeReason>;

export const DraftNotice = z.enum([
  'owner_deactivated',
  'owner_role_changed',
  'destination_removed',
]);
export type DraftNotice = z.infer<typeof DraftNotice>;

export const DestinationKind = z.enum(['channel', 'group']);
export type DestinationKind = z.infer<typeof DestinationKind>;

export const DestinationProblem = z.enum([
  'no_post_right',
  'not_member',
  'chat_gone',
  'not_current_bot',
]);
export type DestinationProblem = z.infer<typeof DestinationProblem>;

/** Trimmed, at most 4096 UTF-16 code units (broadcast-text rule); empty only in a draft. */
export const PostText = z.string().refine((t) => broadcastTextLength(t) <= BROADCAST_TEXT_MAX, {
  message: `at most ${BROADCAST_TEXT_MAX} UTF-16 code units`,
});
export type PostText = z.infer<typeof PostText>;

// ───────── destinations ─────────

export const DestinationRef = z.object({
  id: Id,
  kind: DestinationKind,
  title: z.string().min(1),
  username: z.string().nullable(),
  availability: z.enum(['available', 'unavailable']),
  problem: DestinationProblem.nullable(),
});
export type DestinationRef = z.infer<typeof DestinationRef>;

export const Destination = DestinationRef.extend({
  scheduled_count: Count,
  connected_by: MemberRef,
  connected_at: DateTime,
});
export type Destination = z.infer<typeof Destination>;

export const DestinationList = z.object({
  workspace_id: Id,
  time_zone: z.string().max(64).nullable(),
  scheduled_total: Count,
  items: z.array(Destination).max(20),
});
export type DestinationList = z.infer<typeof DestinationList>;

export const DestinationCodeCreated = z.object({
  id: Id,
  code: z.string().regex(/^tgp_[A-Za-z0-9_-]{22,64}$/),
  group_command: z.string(),
  expires_at: DateTime,
});
export type DestinationCodeCreated = z.infer<typeof DestinationCodeCreated>;

export const DestinationCodeStatus = z.object({
  id: Id,
  status: z.enum([
    'waiting',
    'connected',
    'no_post_right',
    'destination_limit',
    'expired',
    'replaced',
  ]),
  expires_at: DateTime,
  needed_right: z.enum(['post_messages', 'send_messages']).nullable(),
  destination_id: Id.nullable(),
});
export type DestinationCodeStatus = z.infer<typeof DestinationCodeStatus>;

export const DestinationRemoved = z.object({
  outcome: z.enum(['removed', 'unchanged']),
  returned_to_draft: Count,
});
export type DestinationRemoved = z.infer<typeof DestinationRemoved>;

export const TimeZoneSet = z.object({ time_zone: z.string().min(1).max(64) });
export type TimeZoneSet = z.infer<typeof TimeZoneSet>;

export const TimeZoneSaved = z.object({
  outcome: z.enum(['saved', 'unchanged']),
  time_zone: z.string(),
  relabelled_scheduled: Count,
});
export type TimeZoneSaved = z.infer<typeof TimeZoneSaved>;

// ───────── posts ─────────

export const PostSummary = z.object({
  id: Id,
  text_start: z.string().max(120),
  destination: DestinationRef.nullable(),
  state: PostState,
  scheduled_for: DateTime.nullable(),
  published_at: DateTime.nullable(),
  outcome_reason: PostOutcomeReason.nullable(),
  needs_attention: z.boolean(),
  last_changed_by: MemberRef,
  last_changed_at: DateTime,
});
export type PostSummary = z.infer<typeof PostSummary>;

export const PostList = z.object({
  workspace_id: Id,
  time_zone: z.string().nullable(),
  truncated: z.boolean(),
  items: z.array(PostSummary).max(200),
});
export type PostList = z.infer<typeof PostList>;

export const PostSchedulePlan = z.object({
  kind: z.enum(['now', 'time']),
  scheduled_for: DateTime,
  scheduled_by: MemberRef,
});
export type PostSchedulePlan = z.infer<typeof PostSchedulePlan>;

export const Post = z.object({
  id: Id,
  workspace_id: Id,
  state: PostState,
  version: Version,
  text: PostText,
  silent: z.boolean(),
  destination: DestinationRef.nullable(),
  author: MemberRef,
  last_changed_by: MemberRef,
  last_changed_at: DateTime,
  created_at: DateTime,
  schedule: PostSchedulePlan.nullable(),
  published_at: DateTime.nullable(),
  telegram_link: z.string().nullable(),
  deletable_until: DateTime.nullable(),
  outcome_reason: PostOutcomeReason.nullable(),
  outcome_at: DateTime.nullable(),
  needs_attention: z.boolean(),
  draft_notice: DraftNotice.nullable(),
  deleted_at: DateTime.nullable(),
  deleted_by: MemberRef.nullable(),
});
export type Post = z.infer<typeof Post>;

export const PostCreate = z.object({
  text: PostText.optional(),
  destination_id: Id.nullable().optional(),
  silent: z.boolean().optional(),
});
export type PostCreate = z.infer<typeof PostCreate>;

export const ExpectedVersion = z.object({ expected_version: Version });
export type ExpectedVersion = z.infer<typeof ExpectedVersion>;

export const PostSave = ExpectedVersion.extend({
  text: PostText.optional(),
  destination_id: Id.nullable().optional(),
  silent: z.boolean().optional(),
});
export type PostSave = z.infer<typeof PostSave>;

export const PostSchedule = ExpectedVersion.extend({
  local_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  time_zone: z.string().max(64),
});
export type PostSchedule = z.infer<typeof PostSchedule>;

export const PublishBlocker = z.enum([
  'text_empty',
  'no_destination',
  'destination_unavailable',
  'bot_not_working',
  'daily_limit',
  'not_a_draft',
]);
export type PublishBlocker = z.infer<typeof PublishBlocker>;

export const PublishConfirmation = z.object({
  post_id: Id,
  version: Version,
  text: PostText,
  silent: z.boolean(),
  destination: DestinationRef.nullable(),
  time_zone: z.string().nullable(),
  sent_last_24h: Count,
  daily_limit: z.literal(POST_DAILY_LIMIT),
  frees_at: DateTime.nullable(),
  scheduled_waiting: Count,
  scheduled_limit: z.literal(POST_SCHEDULED_LIMIT),
  blockers: z.array(PublishBlocker),
});
export type PublishConfirmation = z.infer<typeof PublishConfirmation>;

export const PostScheduled = z.object({
  outcome: z.enum(['queued', 'scheduled', 'already_scheduled']),
  post: Post,
});
export type PostScheduled = z.infer<typeof PostScheduled>;

export const PostOutcome = z.object({
  outcome: z.enum(['changed', 'unchanged']),
  post: Post,
});
export type PostOutcome = z.infer<typeof PostOutcome>;

export const Outcome = z.object({ outcome: z.enum(['deleted', 'seen', 'unchanged']) });
export type Outcome = z.infer<typeof Outcome>;

export const PostAttention = z.object({ count: Count });
export type PostAttention = z.infer<typeof PostAttention>;
