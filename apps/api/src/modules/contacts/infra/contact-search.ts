import { sql, type RawBuilder } from 'kysely';
import { normalizeSearchQuery } from '../app/ports.js';

/**
 * The inbox search rule as a predicate on `contacts`: the text (after `normalizeSearchQuery`) is
 * contained anywhere in "first last" or in the username, ignoring case in any alphabet, with
 * `%` / `_` matched literally. `null` = nothing to search for. Shared by the id search of the
 * inbox and the Contacts list, so the two never drift.
 */
export function contactSearchPredicate(query: string): RawBuilder<boolean> | null {
  const q = normalizeSearchQuery(query);
  if (q === null) return null;
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return sql<boolean>`(lower(first_name || ' ' || coalesce(last_name, '')) like lower(${pattern})
    or lower(username) like lower(${pattern}))`;
}
