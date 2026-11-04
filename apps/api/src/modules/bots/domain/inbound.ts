/**
 * The inbound filter and update normalisation (flow 2, flow 8). Pure: takes the parsed webhook
 * body and returns what to capture. Only private chats with a human sender, no business
 * connection and not dated before the capture epoch are captured (AC-12); everything else is
 * acknowledged and dropped with a reason (never with message content).
 */

/** Same 15 values as conversations' MESSAGE_KINDS / `messages_kind_check`. */
export type InboundKind =
  | 'text'
  | 'photo'
  | 'video'
  | 'animation'
  | 'voice'
  | 'audio'
  | 'video_note'
  | 'document'
  | 'sticker'
  | 'location'
  | 'venue'
  | 'contact'
  | 'poll'
  | 'dice'
  | 'other';

/**
 * Detection order: the first content field present wins. Telegram sends twins — an animation also
 * carries `document`, a venue also carries `location` — so `animation` precedes `document` and
 * `venue` precedes `location`.
 */
const KIND_FIELDS = [
  'text',
  'photo',
  'video',
  'animation',
  'voice',
  'audio',
  'video_note',
  'document',
  'sticker',
  'venue',
  'location',
  'contact',
  'poll',
  'dice',
] as const satisfies readonly Exclude<InboundKind, 'other'>[];

export interface SenderProfile {
  telegramUserId: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
}

export interface NormalisedMessage {
  kind: InboundKind;
  /** Text, or the caption of any other kind; null when there is neither. */
  body: string | null;
  sentAt: Date;
  chatId: bigint;
  messageId: bigint;
  sender: SenderProfile;
  /** Telegram's message object, stored for its media references. */
  raw: Record<string, unknown>;
}

export interface NormalisedEdit {
  chatId: bigint;
  messageId: bigint;
  /** The new text or caption; null when the edit removed a caption. */
  body: string | null;
  editedAt: Date;
  updateId: bigint;
  /** Telegram's edited message object, stored in place of the old one. */
  raw: Record<string, unknown>;
}

export type IgnoreReason =
  | 'not_private'
  /** A group, supergroup or channel update that is none of the four chat facts. */
  | 'chat_ignored'
  | 'bot_sender'
  | 'business'
  | 'before_epoch'
  | 'unsupported_update'
  | 'malformed'
  | 'no_text'
  /** A `my_chat_member` status other than `kicked` / `member`. */
  | 'unsupported_status';

/**
 * A private user blocked (`kicked`) or unblocked (`member`) the bot, at Telegram's time
 * (ADR-0003). Never a message: handled before the inbound interceptor and capture.
 */
export interface ReachChange {
  telegramUserId: bigint;
  blocked: boolean;
  at: Date;
}

export type ChatKind = 'group' | 'supergroup' | 'channel';

/** A connect code posted in a group (`/connect tgp_…`) or channel (any post containing it). */
export interface DestinationCode {
  type: 'destination_code';
  chatId: bigint;
  kind: ChatKind;
  title: string;
  username: string | null;
  messageId: bigint;
  code: string;
}

/** The bot's own membership in a group or channel changed. */
export interface ChatMembership {
  type: 'chat_membership';
  chatId: bigint;
  kind: ChatKind;
  title: string;
  username: string | null;
  status: string;
  canPost: boolean;
  date: Date;
}

export interface ChatMigrated {
  type: 'chat_migrated';
  chatId: bigint;
  newChatId: bigint;
}

export interface ChatRenamed {
  type: 'chat_renamed';
  chatId: bigint;
  title: string;
}

export type ChatFact = DestinationCode | ChatMembership | ChatMigrated | ChatRenamed;

export type InboundDecision =
  | ChatFact
  | { type: 'capture'; message: NormalisedMessage }
  | { type: 'edit'; edit: NormalisedEdit; sender: SenderProfile }
  | ({ type: 'reach' } & ReachChange)
  | { type: 'ignore'; reason: IgnoreReason };

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const optionalString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const ignore = (reason: IgnoreReason): InboundDecision => ({ type: 'ignore', reason });

export function detectKind(message: Obj): InboundKind {
  return KIND_FIELDS.find((field) => message[field] !== undefined) ?? 'other';
}

function senderOf(from: Obj): SenderProfile {
  return {
    telegramUserId: BigInt(from.id as number),
    firstName: from.first_name as string,
    lastName: optionalString(from.last_name),
    username: optionalString(from.username),
    languageCode: optionalString(from.language_code),
  };
}

function bodyOf(message: Obj): string | null {
  return optionalString(message.text) ?? optionalString(message.caption);
}

/**
 * Checks the fields every captured or edited message needs, then the filter: a reason, or the
 * parts. The epoch is compared with the time the customer acted: `date` for a message,
 * `edit_date` for an edit — so an edit made after connecting again still reaches a message
 * captured in an earlier epoch (AC-10 with AC-19).
 */
function filter(
  message: unknown,
  connectedAt: Date,
  actedAt: 'date' | 'edit_date',
): IgnoreReason | { message: Obj; from: Obj } {
  if (!isObject(message) || !isInt(message.message_id) || !isInt(message.date)) return 'malformed';
  if (!isInt(message[actedAt])) return 'malformed';
  const chat = message.chat;
  if (!isObject(chat) || !isInt(chat.id) || typeof chat.type !== 'string') return 'malformed';
  if (message.business_connection_id !== undefined) return 'business';
  if (chat.type !== 'private') return 'chat_ignored';
  const from = message.from;
  if (!isObject(from) || !isInt(from.id) || typeof from.first_name !== 'string') {
    return 'malformed';
  }
  if (from.is_bot === true) return 'bot_sender';
  // Telegram dates are whole seconds; "before" means a strictly earlier second.
  if ((message[actedAt] as number) < Math.floor(connectedAt.getTime() / 1000)) {
    return 'before_epoch';
  }
  return { message, from };
}

const CHAT_KINDS: readonly string[] = ['group', 'supergroup', 'channel'];
const isChatKind = (v: unknown): v is ChatKind => typeof v === 'string' && CHAT_KINDS.includes(v);

const CODE_PATTERN = /tgp_[A-Za-z0-9_-]+/;
const CONNECT_PATTERN = /^\/connect(?:@([A-Za-z0-9_]+))?\s+(tgp_[A-Za-z0-9_-]+)(?:\s|$)/;

function chatIdentity(chat: Obj): { title: string; username: string | null } {
  return { title: optionalString(chat.title) ?? '', username: optionalString(chat.username) };
}

/** Can the bot post in this chat with this membership? */
function canPostAs(kind: ChatKind, member: Obj): boolean {
  switch (member.status) {
    case 'creator':
      return true;
    case 'administrator':
      return kind === 'channel' ? member.can_post_messages === true : true;
    case 'member':
      return kind !== 'channel';
    case 'restricted':
      return kind !== 'channel' && member.can_send_messages === true;
    default:
      return false;
  }
}

function classifyChatMembership(update: Obj, chat: Obj, member: Obj): InboundDecision {
  return {
    type: 'chat_membership',
    chatId: BigInt(chat.id as number),
    kind: chat.type as ChatKind,
    ...chatIdentity(chat),
    status: member.status as string,
    canPost: canPostAs(chat.type as ChatKind, member),
    date: new Date((update.date as number) * 1000),
  };
}

/**
 * A new message (or channel post) in a group, supergroup or channel: only a connect code, a
 * migration or a rename is a fact; everything else is dropped, never captured (AC-17).
 */
function classifyChatMessage(
  message: Obj,
  botUsername: string | undefined,
  allowCommand: boolean,
): InboundDecision {
  const chat = message.chat as Obj;
  if (!isInt(message.message_id) || !isInt(chat.id)) return ignore('malformed');
  if (message.business_connection_id !== undefined) return ignore('business');
  const kind = chat.type as ChatKind;
  const chatId = BigInt(chat.id);
  if (isInt(message.migrate_to_chat_id)) {
    return { type: 'chat_migrated', chatId, newChatId: BigInt(message.migrate_to_chat_id) };
  }
  if (typeof message.new_chat_title === 'string') {
    return { type: 'chat_renamed', chatId, title: message.new_chat_title };
  }
  const text = optionalString(message.text);
  let code: string | undefined;
  if (kind === 'channel') {
    code = text?.match(CODE_PATTERN)?.[0];
  } else if (allowCommand && text !== null) {
    const match = text.match(CONNECT_PATTERN);
    const target = match?.[1];
    if (
      match &&
      (target === undefined ||
        botUsername === undefined ||
        target.toLowerCase() === botUsername.toLowerCase())
    ) {
      code = match[2];
    }
  }
  if (code === undefined) return ignore('chat_ignored');
  return {
    type: 'destination_code',
    chatId,
    kind,
    ...chatIdentity(chat),
    messageId: BigInt(message.message_id),
    code,
  };
}

/**
 * `my_chat_member` in a private chat: the user's block (`kicked`) or unblock (`member`) of the bot.
 * Not filtered by the capture epoch: the reach row keeps the newest fact (ADR-0002).
 */
function classifyMemberUpdate(update: unknown): InboundDecision {
  if (!isObject(update) || !isInt(update.date)) return ignore('malformed');
  const { chat, from, new_chat_member: member } = update;
  if (!isObject(chat) || !isInt(chat.id) || typeof chat.type !== 'string')
    return ignore('malformed');
  if (!isObject(from) || !isInt(from.id)) return ignore('malformed');
  if (!isObject(member) || typeof member.status !== 'string') return ignore('malformed');
  if (isChatKind(chat.type)) return classifyChatMembership(update, chat, member);
  if (chat.type !== 'private') return ignore('not_private');
  if (member.status !== 'kicked' && member.status !== 'member') {
    return ignore('unsupported_status');
  }
  return {
    type: 'reach',
    telegramUserId: BigInt(from.id),
    blocked: member.status === 'kicked',
    at: new Date(update.date * 1000),
  };
}

export function classifyUpdate(
  update: unknown,
  { connectedAt, botUsername }: { connectedAt: Date; botUsername?: string },
): InboundDecision {
  if (!isObject(update) || !isInt(update.update_id)) return ignore('malformed');

  if (update.channel_post !== undefined) {
    const post = update.channel_post;
    if (!isObject(post) || !isInt(post.date) || !isObject(post.chat)) return ignore('malformed');
    return post.chat.type === 'channel'
      ? classifyChatMessage(post, botUsername, false)
      : ignore('chat_ignored');
  }

  if (update.my_chat_member !== undefined) return classifyMemberUpdate(update.my_chat_member);

  if (update.message !== undefined) {
    const raw = update.message;
    if (isObject(raw) && isObject(raw.chat) && isChatKind(raw.chat.type)) {
      if (!isInt(raw.date)) return ignore('malformed');
      return raw.chat.type === 'channel'
        ? ignore('chat_ignored')
        : classifyChatMessage(raw, botUsername, true);
    }
    const passed = filter(update.message, connectedAt, 'date');
    if (typeof passed === 'string') return ignore(passed);
    const { message, from } = passed;
    return {
      type: 'capture',
      message: {
        kind: detectKind(message),
        body: bodyOf(message),
        sentAt: new Date((message.date as number) * 1000),
        chatId: BigInt((message.chat as Obj).id as number),
        messageId: BigInt(message.message_id as number),
        sender: senderOf(from),
        raw: message,
      },
    };
  }

  if (update.edited_message !== undefined) {
    const passed = filter(update.edited_message, connectedAt, 'edit_date');
    if (typeof passed === 'string') return ignore(passed);
    const { message, from } = passed;
    const body = bodyOf(message);
    // A shared live location arrives as edits without text: nothing to change (AC-09). Any other
    // edit without text or caption removed the caption (the repository never empties a text).
    const kind = detectKind(message);
    if (body === null && (kind === 'location' || kind === 'venue')) return ignore('no_text');
    return {
      type: 'edit',
      edit: {
        chatId: BigInt((message.chat as Obj).id as number),
        messageId: BigInt(message.message_id as number),
        body,
        editedAt: new Date((message.edit_date as number) * 1000),
        updateId: BigInt(update.update_id),
        raw: message,
      },
      sender: senderOf(from),
    };
  }

  return ignore('unsupported_update');
}
