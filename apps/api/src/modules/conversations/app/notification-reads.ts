import type { NotificationReads } from './ports.js';

export interface NotificationReadsDeps {
  reads: NotificationReads;
}

/** What `notifications` (and later the attention route) call on the conversations app layer. */
export function createNotificationReads({ reads }: NotificationReadsDeps): NotificationReads {
  return {
    waitingForPings: (workspaceId, query, tx) => reads.waitingForPings(workspaceId, query, tx),
    attentionCount: (workspaceId, accountId, activeSince) =>
      reads.attentionCount(workspaceId, accountId, activeSince),
  };
}
