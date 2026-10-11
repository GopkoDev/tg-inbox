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
  body: string;
  editedAt: Date;
  updateId: bigint;
}

export type IgnoreReason =
  | 'not_private'
  | 'bot_sender'
  | 'business'
  | 'before_epoch'
  | 'unsupported_update'
  | 'malformed'
  | 'no_text';

export type InboundDecision =
  | { type: 'capture'; message: NormalisedMessage }
  | { type: 'edit'; edit: NormalisedEdit }
  | { type: 'ignore'; reason: IgnoreReason };

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const optionalString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const ignore = (reason: IgnoreReason): InboundDecision => ({ type: 'ignore', reason });

export function detectKind(message: Obj): InboundKind {
  return KIND_FIELDS.find((field) => message[field] !== undefined) ?? 'other';
}

function bodyOf(message: Obj): string | null {
  return optionalString(message.text) ?? optionalString(message.caption);
}

/** Checks the fields every captured or edited message needs, then the filter: a reason, or the parts. */
function filter(message: unknown, connectedAt: Date): IgnoreReason | { message: Obj; from: Obj } {
  if (!isObject(message) || !isInt(message.message_id) || !isInt(message.date)) return 'malformed';
  const chat = message.chat;
  if (!isObject(chat) || !isInt(chat.id) || typeof chat.type !== 'string') return 'malformed';
  if (message.business_connection_id !== undefined) return 'business';
  if (chat.type !== 'private') return 'not_private';
  const from = message.from;
  if (!isObject(from) || !isInt(from.id) || typeof from.first_name !== 'string') {
    return 'malformed';
  }
  if (from.is_bot === true) return 'bot_sender';
  // Telegram dates are whole seconds; "before" means a strictly earlier second.
  if (message.date < Math.floor(connectedAt.getTime() / 1000)) return 'before_epoch';
  return { message, from };
}

export function classifyUpdate(
  update: unknown,
  { connectedAt }: { connectedAt: Date },
): InboundDecision {
  if (!isObject(update) || !isInt(update.update_id)) return ignore('malformed');

  if (update.message !== undefined) {
    const passed = filter(update.message, connectedAt);
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
        sender: {
          telegramUserId: BigInt(from.id as number),
          firstName: from.first_name as string,
          lastName: optionalString(from.last_name),
          username: optionalString(from.username),
          languageCode: optionalString(from.language_code),
        },
        raw: message,
      },
    };
  }

  if (update.edited_message !== undefined) {
    const passed = filter(update.edited_message, connectedAt);
    if (typeof passed === 'string') return ignore(passed);
    const { message } = passed;
    if (!isInt(message.edit_date)) return ignore('malformed');
    const body = bodyOf(message);
    // A shared live location arrives as edits without text: nothing to change (AC-09).
    if (body === null) return ignore('no_text');
    return {
      type: 'edit',
      edit: {
        chatId: BigInt((message.chat as Obj).id as number),
        messageId: BigInt(message.message_id as number),
        body,
        editedAt: new Date(message.edit_date * 1000),
        updateId: BigInt(update.update_id),
      },
    };
  }

  return ignore('unsupported_update');
}
