export const REPLY_LIMIT = 4096;

/** Longer than the limit in UTF-16 units (`String.length`), the unit the API counts too. */
export function isTooLong(text: string): boolean {
  return text.length > REPLY_LIMIT;
}

/** A reply can be sent when it has visible text and fits the limit. */
export function canSendReply(text: string): boolean {
  return text.trim().length > 0 && !isTooLong(text);
}

/** Whole seconds left until `retryAt` (rounded up), never negative. */
export function secondsUntil(retryAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(retryAt).getTime() - now) / 1000));
}
