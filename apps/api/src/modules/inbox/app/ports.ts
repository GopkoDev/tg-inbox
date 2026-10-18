import type { InboxBotStatus } from '@tg/shared';
import type { Contacts } from '../../contacts/app/contacts.js';
import type { InboxReads } from '../../conversations/app/inbox-reads.js';
import type { Clock } from '../../../platform/clock.js';

/** What `inbox` uses of the other modules' app layers (sad.md §5); all passed in by `buildDeps()`. */
export interface InboxReadsDeps {
  conversations: InboxReads;
  contacts: Pick<Contacts, 'searchContactIds' | 'contactsByIds'>;
  workspaces: {
    displayNames(workspaceId: string, accountIds: readonly string[]): Promise<Map<string, string>>;
  };
  bots: { inboxBotStatus(workspaceId: string): Promise<InboxBotStatus> };
  clock: Clock;
}
