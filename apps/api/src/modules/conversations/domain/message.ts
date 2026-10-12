/** What a captured message is (AC-09); mirrors `messages_kind_check`. Unrecognised content is `other`. */
export const MESSAGE_KINDS = [
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
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

const KINDS: ReadonlySet<string> = new Set(MESSAGE_KINDS);

export function isMessageKind(value: string): value is MessageKind {
  return KINDS.has(value);
}
