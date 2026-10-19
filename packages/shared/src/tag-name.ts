// The one rule for what a tag name is and when two names are the same tag
// (ADR-0002): used by the server domain, the picker and the rename dialog.

export const TAG_NAME_MIN = 1;
export const TAG_NAME_MAX = 32;

const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'gu');
const WHITE_SPACE_RUN = /\s+/gu;

/** NFC, zero-width characters removed, every white-space run one space, ends trimmed. */
export const tidyTagName = (raw: string): string =>
  raw.normalize('NFC').replace(ZERO_WIDTH, '').replace(WHITE_SPACE_RUN, ' ').trim();

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Length in grapheme clusters, so an emoji counts as one. */
export const tagNameLength = (tidied: string): number => {
  return Array.from(segmenter.segment(tidied)).length;
};

/** Case-folded key: ß / SS and final sigma fold together. */
export const tagNameKey = (tidied: string): string => tidied.toUpperCase().toLowerCase();

export type TagNameCheck = { ok: true; name: string; key: string } | { ok: false };

export const checkTagName = (raw: string): TagNameCheck => {
  const name = tidyTagName(raw);
  const length = tagNameLength(name);
  if (length < TAG_NAME_MIN || length > TAG_NAME_MAX) return { ok: false };
  return { ok: true, name, key: tagNameKey(name) };
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Tag-list order for lists the web holds: dictionary order ignoring case, key as tiebreak. */
export const compareTagListOrder = (
  a: { name: string; key: string },
  b: { name: string; key: string },
): number => collator.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
