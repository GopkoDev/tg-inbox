import { REPLY_MAX } from './rules.js';

export type ReplyTextCheck = 'ok' | 'blank' | 'too_long';

/** Length is counted in UTF-16 units (`text.length`), as Telegram counts it. */
export function checkReplyText(text: string): ReplyTextCheck {
  if (text.trim().length === 0) return 'blank';
  if (text.length > REPLY_MAX) return 'too_long';
  return 'ok';
}
