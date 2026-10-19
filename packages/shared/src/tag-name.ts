// The one rule for what a tag name is and when two names are the same tag
// (ADR-0002): used by the server domain, the picker and the rename dialog.

export const TAG_NAME_MIN = 1;
export const TAG_NAME_MAX = 32;

// The invisible zero-width spaces go; the joiners (U+200C ZWNJ, U+200D ZWJ) stay in the name,
// because they hold multi-part emoji and some scripts together, but a joiner next to white space
// joins nothing and folds into that one space, and they are trimmed at the ends with the spaces, so
// a name made only of them is empty. The key drops them, so a joiner never splits a look-alike.
// RegExp strings, not literals: prettier would unescape them.
const ZERO_WIDTH_SPACE = new RegExp('[\\u200B\\u2060\\uFEFF]', 'gu');
const WHITE_SPACE_RUN = new RegExp('[\\s\\u200C\\u200D]*\\s[\\s\\u200C\\u200D]*', 'gu');
const JOINER = new RegExp('[\\u200C\\u200D]', 'gu');
const BLANK_ENDS = new RegExp('^[\\s\\u200C\\u200D]+|[\\s\\u200C\\u200D]+$', 'gu');

/**
 * NFC, zero-width spaces removed, every white-space run (with the joiners next to it) one space,
 * spaces and joiners trimmed at the ends.
 */
export const tidyTagName = (raw: string): string =>
  raw
    .normalize('NFC')
    .replace(ZERO_WIDTH_SPACE, '')
    .replace(WHITE_SPACE_RUN, ' ')
    .replace(BLANK_ENDS, '');

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Length in grapheme clusters, so an emoji counts as one. */
export const tagNameLength = (tidied: string): number => {
  return Array.from(segmenter.segment(tidied)).length;
};

/** Case-folded key, joiners dropped: ß / SS and final sigma fold together, V+ZWNJ+IP is VIP. */
export const tagNameKey = (tidied: string): string =>
  tidied.replace(JOINER, '').toUpperCase().toLowerCase();

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
