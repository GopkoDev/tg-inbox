// The one rule for a broadcast's text and name (ADR-0012): used by the web editor's counter,
// the request handling and the launch check, so the count a member sees is the count Telegram
// applies and the customer gets exactly the trimmed text.
import { tagNameLength, tidyTagName } from './tag-name.js';

export const BROADCAST_TEXT_MAX = 4096;
export const BROADCAST_NAME_MAX = 80;

/** Spaces, tabs and line breaks removed at both ends; everything inside is kept. */
export const tidyBroadcastText = (raw: string): string => raw.trim();

/** Telegram's count: UTF-16 code units, so an emoji takes 2. */
export const broadcastTextLength = (tidied: string): number => tidied.length;

export type BroadcastTextCheck =
  | { ok: true; text: string; length: number }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'too_long'; length: number; over: number };

export const checkBroadcastText = (raw: string): BroadcastTextCheck => {
  const text = tidyBroadcastText(raw);
  const length = broadcastTextLength(text);
  if (length === 0) return { ok: false, reason: 'empty' };
  if (length > BROADCAST_TEXT_MAX) {
    return { ok: false, reason: 'too_long', length, over: length - BROADCAST_TEXT_MAX };
  }
  return { ok: true, text, length };
};

/** Tidied like a tag name (NFC, zero-width spaces gone, white-space runs one space, ends trimmed). */
export const tidyBroadcastName = (raw: string): string => tidyTagName(raw);

export type BroadcastNameCheck = { ok: true; name: string } | { ok: false };

/** 1–80 characters as a person sees them (graphemes, an emoji is one). */
export const checkBroadcastName = (raw: string): BroadcastNameCheck => {
  const name = tidyBroadcastName(raw);
  const length = tagNameLength(name);
  if (length < 1 || length > BROADCAST_NAME_MAX) return { ok: false };
  return { ok: true, name };
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** "Copy of …" cut to 80 graphemes at a grapheme boundary, tidied so it is a valid name. */
export const copyName = (source: string): string => {
  const full = `Copy of ${tidyBroadcastName(source)}`;
  const graphemes = Array.from(segmenter.segment(full), (s) => s.segment);
  return tidyBroadcastName(graphemes.slice(0, BROADCAST_NAME_MAX).join(''));
};
