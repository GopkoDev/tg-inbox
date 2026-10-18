import type { ConversationSummary, InboxBotStatus } from '@tg/shared';
import type { Contacts } from '../../contacts/app/contacts.js';
import type { InboxReads } from '../../conversations/app/inbox-reads.js';
import type { Executor } from '../../conversations/app/ports.js';
import type { StateChanges } from '../../conversations/app/state-changes.js';
import type { Clock } from '../../../platform/clock.js';

/** What `inbox` uses of the other modules' app layers (sad.md §5); all passed in by `buildDeps()`. */
export interface InboxReadsDeps {
  conversations: InboxReads;
  contacts: Pick<Contacts, 'searchContactIds' | 'contactsByIds'>;
  workspaces: {
    displayNames(workspaceId: string, accountIds: readonly string[]): Promise<Map<string, string>>;
    activeMembers(workspaceId: string): Promise<{ accountId: string; displayName: string }[]>;
  };
  bots: { inboxBotStatus(workspaceId: string): Promise<InboxBotStatus> };
  clock: Clock;
}

/** What the member-change use cases of `inbox` use of `workspaces` and `conversations` (sad.md §5). */
export interface ChangeStateDeps {
  transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;
  workspaces: {
    /** `FOR SHARE` on the memberships; returns the active accounts among `accountIds`. */
    lockActiveMembers(
      tx: Executor,
      workspaceId: string,
      accountIds: readonly string[],
    ): Promise<string[]>;
    displayNames(workspaceId: string, accountIds: readonly string[]): Promise<Map<string, string>>;
  };
  changes: Pick<StateChanges, 'changeAssignee' | 'changeStatus'>;
  reads: {
    getConversation(
      workspaceId: string,
      member: { accountId: string; activeSince: Date },
      conversationId: string,
    ): Promise<ConversationSummary>;
  };
  clock: Clock;
}
