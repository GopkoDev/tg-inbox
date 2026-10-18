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

export const ThreadItem = z.discriminatedUnion('type', [ThreadMessage, ThreadReply]);
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
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationPage = z.strictObject({
  workspace_id: Id,
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

// ───────── other answers ─────────

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
    item: z.object({ type: z.enum(['message', 'reply']), id: Id }).nullable(),
    change: z.enum(['created', 'edited', 'state', 'read']),
  })
  .refine((f) => f.item !== null || f.change === 'read', {
    message: 'item may be null only for a read change',
    path: ['item'],
  });

export const BotChangedFrame = z.object({ ...frameBase, type: z.literal('bot.changed') });
export const ResyncFrame = z.object({ ...frameBase, type: z.literal('resync') });

export const LiveFrame = z.discriminatedUnion('type', [
  ConversationChangedFrame,
  BotChangedFrame,
  ResyncFrame,
]);
export type LiveFrame = z.infer<typeof LiveFrame>;
