import { tagNameKey, tidyTagName } from '@tg/shared';

export interface TagOption {
  id: string;
  name: string;
}

export interface MatchRow<T extends TagOption = TagOption> {
  tag: T;
  /** The contact already carries it: shown as carried, never offered again. */
  carried: boolean;
}

export interface TagMatches<T extends TagOption = TagOption> {
  rows: MatchRow<T>[];
  /** The tidied text for the «Create tag» row; null when a tag has that name or nothing is typed. */
  create: string | null;
}

/**
 * The tag picker's suggestions (SCR-20, AC-06, AC-08), with the shared tidy and fold rules: an
 * empty field lists every tag; an exact name (ignoring case and spacing) offers only that tag;
 * otherwise tags whose name starts with the text, then those that contain it, each group in the
 * order given (tag-list order), and the create row. The server decides again.
 */
export function matchTags<T extends TagOption>(
  tags: readonly T[],
  typed: string,
  carried: Iterable<string>,
): TagMatches<T> {
  const on = new Set(carried);
  const row = (tag: T): MatchRow<T> => ({ tag, carried: on.has(tag.id) });
  const text = tidyTagName(typed);
  if (!text) return { rows: tags.map(row), create: null };
  const key = tagNameKey(text);
  const keyed = tags.map((tag) => ({ tag, key: tagNameKey(tidyTagName(tag.name)) }));
  const exact = keyed.find((t) => t.key === key);
  if (exact) return { rows: [row(exact.tag)], create: null };
  const starts = keyed.filter((t) => t.key.startsWith(key));
  const contains = keyed.filter((t) => !t.key.startsWith(key) && t.key.includes(key));
  return { rows: [...starts, ...contains].map((t) => row(t.tag)), create: text };
}
