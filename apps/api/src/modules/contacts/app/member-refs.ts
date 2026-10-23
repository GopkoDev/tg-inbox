import type { MemberRef } from '@tg/shared';
import type { DisplayNames } from './ports.js';

/**
 * Resolves the names of accounts once and returns the lookup. A kept membership always has a name;
 * the fallback only guards a removed account.
 */
export async function memberRefs(
  workspaces: DisplayNames,
  workspaceId: string,
  accountIds: readonly string[],
): Promise<(accountId: string) => MemberRef> {
  const unique = [...new Set(accountIds)];
  const names = unique.length
    ? await workspaces.displayNames(workspaceId, unique)
    : new Map<string, string>();
  return (accountId) => ({ account_id: accountId, display_name: names.get(accountId) ?? '?' });
}
