import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Update } from 'grammy/types';

/**
 * Webhook payload builders (private chat, human sender by default) for capture tests.
 * PII guard: `Test User`, `test_user_<id>`, small synthetic ids, no real tokens.
 */

const file = (id: string) => ({ file_id: `file-${id}`, file_unique_id: `uniq-${id}` });

/** Content fields per captured kind, as Telegram sends them (sad.md §8 Message kinds). */
export const MESSAGE_KIND_FIXTURES: Record<string, () => Record<string, unknown>> = {
  text: () => ({ text: 'Hello' }),
  photo: () => ({
    photo: [
      { ...file('p-s'), width: 90, height: 90, file_size: 1000 },
      { ...file('p-m'), width: 800, height: 800, file_size: 50000 },
    ],
  }),
  video: () => ({ video: { ...file('v'), width: 640, height: 360, duration: 5 } }),
  // Telegram sends an animation with a `document` twin for old clients.
  animation: () => ({
    animation: { ...file('a'), width: 320, height: 240, duration: 2 },
    document: { ...file('a'), file_name: 'a.mp4', mime_type: 'video/mp4' },
  }),
  voice: () => ({ voice: { ...file('vo'), duration: 3, mime_type: 'audio/ogg' } }),
  audio: () => ({ audio: { ...file('au'), duration: 120, title: 'Test Track' } }),
  video_note: () => ({ video_note: { ...file('vn'), length: 240, duration: 4 } }),
  document: () => ({
    document: { ...file('d'), file_name: 'test.pdf', mime_type: 'application/pdf' },
  }),
  sticker: () => ({
    sticker: {
      ...file('s'),
      type: 'regular',
      width: 512,
      height: 512,
      is_animated: false,
      is_video: false,
    },
  }),
  location: () => ({ location: { latitude: 50.45, longitude: 30.52 } }),
  // A venue message carries its location twice: in `venue` and as `location`.
  venue: () => ({
    venue: {
      location: { latitude: 50.45, longitude: 30.52 },
      title: 'Test Venue',
      address: 'Test Street 1',
    },
    location: { latitude: 50.45, longitude: 30.52 },
  }),
  contact: () => ({ contact: { phone_number: '+0000000000', first_name: 'Test Contact' } }),
  poll: () => ({
    poll: {
      id: 'poll-1',
      question: 'Test question?',
      options: [
        { text: 'Yes', voter_count: 0 },
        { text: 'No', voter_count: 0 },
      ],
      total_voter_count: 0,
      is_closed: false,
      is_anonymous: true,
      type: 'regular',
      allows_multiple_answers: false,
    },
  }),
  dice: () => ({ dice: { emoji: '🎲', value: 3 } }),
  // A content type tg-inbox does not recognise (a forwarded story) → kind `other`.
  other: () => ({ story: { chat: { id: 700999, type: 'private' }, id: 1 } }),
};

/** Kinds Telegram allows a caption on. */
export const CAPTIONED_KINDS = new Set([
  'photo',
  'video',
  'animation',
  'voice',
  'audio',
  'document',
]);

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface MessageOptions {
  messageId: number;
  /** Unix seconds. */
  date: number;
  chatId?: number;
  fromId?: number;
  text?: string;
  caption?: string;
  /** One of MESSAGE_KIND_FIXTURES; default `text`. */
  kind?: string;
  chatType?: ChatType;
  fromIsBot?: boolean;
  businessConnectionId?: string;
  mediaGroupId?: string;
  from?: { first_name?: string; last_name?: string; username?: string; language_code?: string };
}

export interface UpdateOptions extends MessageOptions {
  updateId: number;
}

export interface EditOptions extends UpdateOptions {
  editDate: number;
  /** An edit of a shared live location: new coordinates, no text or caption. */
  liveLocation?: boolean;
}

function buildMessage(o: MessageOptions): Record<string, unknown> {
  const fromId = o.fromId ?? o.chatId ?? 700001;
  const chatType = o.chatType ?? 'private';
  const chatId = o.chatId ?? (chatType === 'private' ? fromId : -1000000000 - fromId);
  const chat =
    chatType === 'private'
      ? { id: chatId, type: 'private', first_name: 'Test User' }
      : { id: chatId, type: chatType, title: 'Test Group' };
  const kind = o.kind ?? 'text';
  const content = MESSAGE_KIND_FIXTURES[kind];
  if (!content) throw new Error(`unknown fixture kind ${kind}`);
  const message: Record<string, unknown> = {
    message_id: o.messageId,
    date: o.date,
    chat,
    ...(chatType !== 'channel' && {
      from: {
        id: fromId,
        is_bot: o.fromIsBot ?? false,
        first_name: o.fromIsBot ? `Test Bot ${fromId}` : 'Test User',
        username: o.fromIsBot ? `test_bot_${fromId}` : `test_user_${fromId}`,
        language_code: 'en',
        ...o.from,
      },
    }),
    ...(chatType === 'channel' && { sender_chat: chat }),
    ...content(),
  };
  if (kind === 'text' && o.text !== undefined) message.text = o.text;
  if (o.caption !== undefined && CAPTIONED_KINDS.has(kind)) message.caption = o.caption;
  if (o.businessConnectionId) message.business_connection_id = o.businessConnectionId;
  if (o.mediaGroupId) message.media_group_id = o.mediaGroupId;
  return message;
}

/** A webhook delivery of a new message (`channel_post` for a channel chat). */
export function telegramUpdate(o: UpdateOptions): Update {
  const message = buildMessage(o);
  const key = o.chatType === 'channel' ? 'channel_post' : 'message';
  return { update_id: o.updateId, [key]: message } as unknown as Update;
}

/** A webhook delivery of an edit (`edited_message`). */
export function telegramEdit(o: EditOptions): Update {
  const message = o.liveLocation
    ? {
        ...buildMessage({ ...o, kind: 'location' }),
        location: { latitude: 50.46, longitude: 30.53, live_period: 3600, heading: 90 },
      }
    : buildMessage(o);
  return {
    update_id: o.updateId,
    edited_message: { ...message, edit_date: o.editDate },
  } as unknown as Update;
}

/** Posts an update to the bot's webhook route with its secret header, like Telegram does. */
export function signedDelivery(
  app: FastifyInstance,
  bot: { id: string; secret: string },
  update: unknown,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/api/telegram/webhook/${bot.id}`,
    headers: { 'x-telegram-bot-api-secret-token': bot.secret },
    payload: update as Record<string, unknown>,
  });
}
