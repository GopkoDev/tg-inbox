import { TagFilterMode } from '@tg/shared';
import { z } from 'zod';

/**
 * The Contacts list's view, kept in the page address (`?q=<text>&mode=any|all|none&tag=<id>…`):
 * tag ids, not names, so a saved link survives a rename (AC-02).
 */
export interface ContactsAddress {
  q: string;
  mode: TagFilterMode;
  tagIds: string[];
}

export const EMPTY_ADDRESS: ContactsAddress = { q: '', mode: 'any', tagIds: [] };

const TagId = z.uuid();
/** The API's bounds on `listContacts` (more is a `400`). */
export const MAX_TAG_IDS = 100;
export const MAX_SEARCH_LENGTH = 200;

/** The search text as sent: trimmed, at most 200 UTF-16 units, never ending in half a pair. */
export function searchText(raw: string): string {
  let q = raw.trim();
  if (q.length <= MAX_SEARCH_LENGTH) return q;
  q = q.slice(0, MAX_SEARCH_LENGTH);
  const last = q.charCodeAt(q.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) q = q.slice(0, -1);
  return q.trimEnd();
}

/**
 * Reads the view from the address. What the API would refuse (a malformed or repeated tag id, an
 * unknown mode, tags together with mode `none`, more than 100 tag ids, a search over 200
 * characters) is left out, and `canonical` is false when the
 * address must be rewritten in place (those, a spelled-out default, an empty search).
 */
export function parseAddress(params: URLSearchParams): {
  address: ContactsAddress;
  canonical: boolean;
} {
  const mode = TagFilterMode.safeParse(params.get('mode'));
  const chosen = mode.success ? mode.data : 'any';
  const seen = new Set<string>();
  const tagIds: string[] = [];
  for (const raw of params.getAll('tag')) {
    if (tagIds.length === MAX_TAG_IDS) break;
    if (!TagId.safeParse(raw).success || seen.has(raw)) continue;
    seen.add(raw);
    tagIds.push(raw);
  }
  const address: ContactsAddress = {
    q: searchText(params.get('q') ?? ''),
    mode: chosen,
    tagIds: chosen === 'none' ? [] : tagIds,
  };
  const written = withAddress(params, address);
  const same = (key: string) =>
    JSON.stringify(written.getAll(key)) === JSON.stringify(params.getAll(key));
  return { address, canonical: same('q') && same('mode') && same('tag') };
}

/** The address parameters for `address`: defaults omitted, other parameters kept. */
export function withAddress(params: URLSearchParams, address: ContactsAddress): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('q');
  next.delete('mode');
  next.delete('tag');
  if (address.q !== '') next.set('q', address.q);
  if (address.mode !== 'any') next.set('mode', address.mode);
  if (address.mode !== 'none') for (const id of address.tagIds) next.append('tag', id);
  return next;
}

/** A search or a filter is on: the counts read «N of M» and the empty state offers Clear. */
export const isFiltered = (a: ContactsAddress) =>
  a.q !== '' || a.mode === 'none' || a.tagIds.length > 0;
