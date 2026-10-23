import { z } from 'zod';

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();

// ───────── paging ─────────

/** Opaque keyset cursor, issued by the server and passed back unchanged. */
export const Cursor = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export type Cursor = z.infer<typeof Cursor>;

// ───────── replies ─────────

/** 1–4096 characters and not only white space (AC-07). */
export const ReplyBody = z.string().min(1).max(4096).regex(/\S/);
export type ReplyBody = z.infer<typeof ReplyBody>;

export const ReplyState = z.enum(['sending', 'sent', 'not_delivered', 'not_confirmed']);
export type ReplyState = z.infer<typeof ReplyState>;

export const ReplyFailureReason = z.enum([
  'customer_blocked',
  'customer_account_gone',
  'chat_not_found',
  'bot_not_working',
  'author_access_removed',
  'telegram_not_accepted',
  'delivery_interrupted',
]);
export type ReplyFailureReason = z.infer<typeof ReplyFailureReason>;

export const MemberRef = z.strictObject({
  account_id: Id,
  display_name: z.string().min(1).max(200),
});
export type MemberRef = z.infer<typeof MemberRef>;

export const ThreadReply = z
  .strictObject({
    type: z.literal('reply'),
    id: Id,
    workspace_id: Id,
    conversation_id: Id,
    client_key: Id,
    body: ReplyBody,
    author: MemberRef,
    state: ReplyState,
    failure_reason: ReplyFailureReason.nullable(),
    position_at: DateTime,
    sent_at: DateTime.nullable(),
    created_at: DateTime,
  })
  .refine((r) => (r.state === 'not_delivered') === (r.failure_reason !== null), {
    message: 'failure_reason is set exactly when state is not_delivered',
    path: ['failure_reason'],
  })
  .refine((r) => (r.state === 'sent') === (r.sent_at !== null), {
    message: 'sent_at is set exactly when state is sent',
    path: ['sent_at'],
  });
export type ThreadReply = z.infer<typeof ThreadReply>;

// ───────── messages ─────────

export const MessageKind = z.enum([
  'text',
  'photo',
  'video',
  'animation',
  'voice',
  'audio',
  'video_note',
  'document',
  'sticker',
  'location',
  'venue',
  'contact',
  'poll',
  'dice',
  'other',
]);
export type MessageKind = z.infer<typeof MessageKind>;

export const MessageAttachment = z.strictObject({
  file_name: z.string().nullable(),
  mime_type: z.string().nullable(),
  file_size: z.number().int().min(0).nullable(),
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

export const MessageLocation = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  venue: z.strictObject({ title: z.string(), address: z.string() }).nullable(),
});
export type MessageLocation = z.infer<typeof MessageLocation>;

export const SharedContact = z.strictObject({
  first_name: z.string(),
  last_name: z.string().nullable(),
  phone_number: z.string(),
});
export type SharedContact = z.infer<typeof SharedContact>;

export const MessagePoll = z.strictObject({
  question: z.string(),
  options: z.array(z.string()),
});
export type MessagePoll = z.infer<typeof MessagePoll>;

export const ThreadMessage = z.strictObject({
  type: z.literal('message'),
  id: Id,
  workspace_id: Id,
  conversation_id: Id,
  kind: MessageKind,
  body: z.string().nullable(),
  sent_at: DateTime,
  received_at: DateTime,
  edited_at: DateTime.nullable(),
  attachment: MessageAttachment.nullable(),
  location: MessageLocation.nullable(),
  shared_contact: SharedContact.nullable(),
  poll: MessagePoll.nullable(),
});
export type ThreadMessage = z.infer<typeof ThreadMessage>;

// ───────── assignment and status (assignment-statuses) ─────────

export const StatusLens = z.enum(['open', 'closed']);
export type StatusLens = z.infer<typeof StatusLens>;

export const AssigneeLens = z.enum(['all', 'mine', 'unassigned']);
export type AssigneeLens = z.infer<typeof AssigneeLens>;

export const ConversationStatus = z.enum(['open', 'closed']);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

/** `conversations.state_version`: raised by one with every assignee or status change. */
export const StateVersion = z.number().int().min(0).max(2147483647);
export type StateVersion = z.infer<typeof StateVersion>;

export const CloseSnapshot = z.strictObject({
  customer_message_seq: z.number().int().min(0).max(2147483647),
  latest_reply: z.strictObject({ id: Id, state: ReplyState }).nullable(),
});
export type CloseSnapshot = z.infer<typeof CloseSnapshot>;

export const ActivityKind = z.enum(['assigned', 'reassigned', 'unassigned', 'closed', 'reopened']);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityCause = z.enum([
  'member',
  'customer_wrote',
  'reply_not_delivered',
  'member_deactivated',
]);
export type ActivityCause = z.infer<typeof ActivityCause>;

export const CloseReason = z.enum([
  'state_changed',
  'customer_waiting',
  'unread_customer_message',
  'new_customer_message',
  'reply_not_delivered',
  'reply_not_confirmed',
]);
export type CloseReason = z.infer<typeof CloseReason>;

/** The (previous, new) assignee pair each kind allows — mirrors the data-model CHECKs. */
const pairFits = (a: {
  kind: ActivityKind;
  previous_assignee: MemberRef | null;
  new_assignee: MemberRef | null;
}): boolean => {
  const prev = a.previous_assignee;
  const next = a.new_assignee;
  switch (a.kind) {
    case 'assigned':
      return prev === null && next !== null;
    case 'reassigned':
      return prev !== null && next !== null && prev.account_id !== next.account_id;
    case 'unassigned':
      return prev !== null && next === null;
    case 'closed':
    case 'reopened':
      return prev === null && next === null;
  }
};

export const ThreadActivity = z
  .strictObject({
    type: z.literal('activity'),
    id: Id,
    workspace_id: Id,
    conversation_id: Id,
    kind: ActivityKind,
    cause: ActivityCause,
    actor: MemberRef.nullable(),
    previous_assignee: MemberRef.nullable(),
    new_assignee: MemberRef.nullable(),
    position_at: DateTime,
  })
  .refine((a) => (a.cause === 'member') === (a.actor !== null), {
    message: 'actor is set exactly when cause is member',
    path: ['actor'],
  })
  .refine(pairFits, {
    message: 'previous_assignee and new_assignee do not fit the kind',
    path: ['new_assignee'],
  });
export type ThreadActivity = z.infer<typeof ThreadActivity>;

export const ThreadItem = z.discriminatedUnion('type', [
  ThreadMessage,
  ThreadReply,
  ThreadActivity,
]);
export type ThreadItem = z.infer<typeof ThreadItem>;

// ───────── list ─────────

export const ContactSummary = z.strictObject({
  id: Id,
  first_name: z.string(),
  last_name: z.string().nullable(),
  username: z.string().nullable(),
});
export type ContactSummary = z.infer<typeof ContactSummary>;

export const LastMessageItem = z.strictObject({
  type: z.literal('message'),
  id: Id,
  kind: MessageKind,
  body: z.string().nullable(),
});

export const LastReplyItem = z.strictObject({
  type: z.literal('reply'),
  id: Id,
  body: ReplyBody,
});

export const LastItem = z.discriminatedUnion('type', [LastMessageItem, LastReplyItem]);
export type LastItem = z.infer<typeof LastItem>;

export const Conversation = z.strictObject({
  id: Id,
  workspace_id: Id,
  contact: ContactSummary,
  last_activity_at: DateTime,
  last_item: LastItem,
  unread_count: z.number().int().min(0),
  waiting_for_reply: z.boolean(),
  status: ConversationStatus,
  assignee: MemberRef.nullable(),
  state_version: StateVersion,
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationSummary = z.strictObject({
  ...Conversation.shape,
  close_snapshot: CloseSnapshot,
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationPage = z.strictObject({
  workspace_id: Id,
  /** The lenses this page answers; `status` is null while searching (the status lens is set aside). */
  lens: z.strictObject({ status: StatusLens.nullable(), assignee: AssigneeLens }),
  items: z.array(Conversation),
  has_prev: z.boolean(),
  has_next: z.boolean(),
  next_cursor: Cursor.nullable(),
});
export type ConversationPage = z.infer<typeof ConversationPage>;

export const ThreadPage = z.strictObject({
  workspace_id: Id,
  conversation_id: Id,
  items: z.array(ThreadItem),
  has_prev: z.boolean(),
  has_next: z.boolean(),
  prev_cursor: Cursor.nullable(),
  next_cursor: Cursor.nullable(),
  read_through_at: DateTime.nullable(),
  /**
   * The conversation's newest reply (thread order), on every page whatever page holds it; null when
   * it has none. The composer sends it as `last_seen_reply_id`. Always sent by the server; optional
   * here only so pages built before it existed still parse.
   */
  newest_reply_id: Id.nullable().optional(),
});
export type ThreadPage = z.infer<typeof ThreadPage>;

// ───────── requests ─────────

export const ReplySend = z.strictObject({
  client_key: Id,
  body: ReplyBody,
  last_seen_reply_id: Id.nullable(),
  confirm_teammate_reply: z.boolean().default(false),
});
export type ReplySend = z.infer<typeof ReplySend>;

export const ReplyResend = z.strictObject({
  confirm_duplicate_risk: z.boolean().default(false),
});
export type ReplyResend = z.infer<typeof ReplyResend>;

export const ReadMarkRequest = z.strictObject({ read_through_at: DateTime });
export type ReadMarkRequest = z.infer<typeof ReadMarkRequest>;

export const AssignRequest = z.strictObject({
  assignee_account_id: Id,
  expected_state_version: StateVersion,
});
export type AssignRequest = z.infer<typeof AssignRequest>;

export const StateChangeRequest = z.strictObject({ expected_state_version: StateVersion });
export type StateChangeRequest = z.infer<typeof StateChangeRequest>;

export const CloseRequest = z.strictObject({
  expected_state_version: StateVersion,
  expected_close_snapshot: CloseSnapshot,
  confirm_close_reasons: z.boolean().default(false),
});
export type CloseRequest = z.infer<typeof CloseRequest>;

// ───────── other answers ─────────

export const ActiveMemberList = z.strictObject({ workspace_id: Id, items: z.array(MemberRef) });
export type ActiveMemberList = z.infer<typeof ActiveMemberList>;

export const ConversationStateChange = z.strictObject({
  workspace_id: Id,
  outcome: z.enum(['recorded', 'unchanged']),
  conversation: ConversationSummary,
  activity: ThreadActivity.nullable(),
});
export type ConversationStateChange = z.infer<typeof ConversationStateChange>;

export const ReadState = z.strictObject({
  workspace_id: Id,
  conversation_id: Id,
  read_through_at: DateTime,
  unread_count: z.number().int().min(0),
});
export type ReadState = z.infer<typeof ReadState>;

export const InboxBotStatus = z.strictObject({
  workspace_id: Id,
  state: z.enum(['connected', 'needs_token', 'taken_over', 'not_connected']),
  can_reply: z.boolean(),
  receiving: z.boolean(),
});
export type InboxBotStatus = z.infer<typeof InboxBotStatus>;

// ───────── refusals ─────────

const refusal = <C extends string, D extends z.ZodType>(code: C, details: D) =>
  z.strictObject({
    error: z.strictObject({ code: z.literal(code), message: z.string(), details }),
  });

export const BotCannotReplyError = refusal(
  'BOT_CANNOT_REPLY',
  z.strictObject({ bot: InboxBotStatus }),
);

export const TeammateRepliedError = refusal(
  'TEAMMATE_REPLIED',
  z.strictObject({
    reply: z.strictObject({ id: Id, author: MemberRef, position_at: DateTime }),
  }),
);

export const ReplyNotResendableError = refusal(
  'REPLY_NOT_RESENDABLE',
  z.strictObject({ reply: ThreadReply }),
);

export const ReplyLimitReachedError = refusal(
  'REPLY_LIMIT_REACHED',
  z.strictObject({
    limit: z.literal(30),
    window_seconds: z.literal(60),
    retry_at: DateTime,
  }),
);

export const ConversationStateChangedError = refusal(
  'CONVERSATION_STATE_CHANGED',
  z.strictObject({ conversation: ConversationSummary, latest_change: ThreadActivity.nullable() }),
);

export const CloseNeedsConfirmationError = refusal(
  'CLOSE_NEEDS_CONFIRMATION',
  z.strictObject({
    reasons: z
      .array(CloseReason)
      .min(1)
      .refine((r) => new Set(r).size === r.length, { message: 'reasons are unique' }),
    stale_change: ThreadActivity.nullable(),
    newest_unread_message: z.strictObject({ id: Id, received_at: DateTime }).nullable(),
    conversation: ConversationSummary,
  }),
);

export const AssigneeNotActiveError = refusal(
  'ASSIGNEE_NOT_ACTIVE',
  z.strictObject({ field: z.literal('assignee_account_id') }),
);

export const ChangeLimitReachedError = refusal(
  'CHANGE_LIMIT_REACHED',
  z.strictObject({
    limit: z.literal(60),
    window_seconds: z.literal(60),
    retry_at: DateTime,
  }),
);

export const MediaUnavailableReason = z.enum([
  'bot_not_connected',
  'bot_not_working',
  'file_too_large',
  'file_gone',
]);
export type MediaUnavailableReason = z.infer<typeof MediaUnavailableReason>;

export const MediaUnavailableError = refusal(
  'MEDIA_UNAVAILABLE',
  z.strictObject({ reason: MediaUnavailableReason }),
);

// ───────── live frames (events.md) ─────────
// Not strict: unknown fields are ignored. An unknown `type` fails safeParse; clients ignore it.

const frameBase = { v: z.literal(1), workspace_id: Id };

export const ConversationChangedFrame = z
  .object({
    ...frameBase,
    type: z.literal('conversation.changed'),
    conversation_id: Id,
    item: z.object({ type: z.enum(['message', 'reply', 'activity']), id: Id }).nullable(),
    change: z.enum(['created', 'edited', 'state', 'read']),
  })
  .refine((f) => f.item !== null || f.change === 'read', {
    message: 'item may be null only for a read change',
    path: ['item'],
  })
  .refine((f) => f.item?.type !== 'activity' || f.change === 'created', {
    message: 'an activity entry is immutable: only created',
    path: ['change'],
  });

export const BotChangedFrame = z.object({ ...frameBase, type: z.literal('bot.changed') });
export const ResyncFrame = z.object({ ...frameBase, type: z.literal('resync') });

/** Delivered to the sockets of the one account whose Telegram link changed (events.md). */
export const TelegramLinkChangedFrame = z.object({
  ...frameBase,
  type: z.literal('telegram_link.changed'),
});

/** One contact's tags changed; ids and a change kind only, to every socket of the workspace (events.md). */
export const ContactChangedFrame = z.object({
  ...frameBase,
  type: z.literal('contact.changed'),
  contact_id: Id,
  change: z.enum(['tags']),
});

/** The workspace's tag list changed (a tag was created, renamed, merged or deleted). */
export const TagsChangedFrame = z.object({ ...frameBase, type: z.literal('tags.changed') });

export const LiveFrame = z.discriminatedUnion('type', [
  ConversationChangedFrame,
  BotChangedFrame,
  ResyncFrame,
  TelegramLinkChangedFrame,
  ContactChangedFrame,
  TagsChangedFrame,
]);
export type LiveFrame = z.infer<typeof LiveFrame>;

/**
 * The one client frame: whether this tab is on screen (events.md). Strict: anything else is ignored.
 * `hidden_for_ms` (optional, only read with `on_screen: false`): how long ago this tab left the screen,
 * measured on the tab's monotonic clock, so a hidden tab that reconnects keeps counting as present for
 * the 10 minutes after it left (D1). A duration, not a wall-clock time: the server anchors it on its own
 * clock, so a browser clock that runs ahead grants nothing.
 */
export const PresenceFrame = z.strictObject({
  type: z.literal('presence'),
  v: z.literal(1),
  on_screen: z.boolean(),
  hidden_for_ms: z.int().nonnegative().optional(),
});
export type PresenceFrame = z.infer<typeof PresenceFrame>;
