export const REPLY_LIMIT = 4096;

/** A reply can be sent when it has visible text and fits the limit. */
export function canSendReply(text: string): boolean {
  return text.trim().length > 0 && text.length <= REPLY_LIMIT;
}
