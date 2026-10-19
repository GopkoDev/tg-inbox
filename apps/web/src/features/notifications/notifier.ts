import type { LiveFrame } from '@tg/shared';
import { getConversation } from '@/features/inbox/api-source';
import { subscribeLive } from '@/shared/api/live-connection';
import { ensureWorker, readState } from './desktop';

interface NotifierOptions {
  workspaceId: string;
  workspaceName: string;
  accountId: string;
  /** Opens a panel address in place (the router's navigate). */
  navigate: (path: string) => void;
}

const conversationPath = (workspaceId: string, conversationId: string) =>
  `/w/${workspaceId}/inbox/${conversationId}`;

/** Only a new customer message can be a candidate (OS-02); a reply, activity or edit never is. */
function isNewMessage(frame: LiveFrame, workspaceId: string) {
  if (frame.type !== 'conversation.changed' || frame.workspace_id !== workspaceId) return null;
  if (frame.change !== 'created' || frame.item?.type !== 'message') return null;
  return { conversationId: frame.conversation_id, messageId: frame.item.id };
}

async function post(message: unknown) {
  const registration = await navigator.serviceWorker.getRegistration('/');
  registration?.active?.postMessage(message);
}

/**
 * The tab's part of desktop notifications (ADR-0009, AC-02): on a new customer message it re-reads
 * the conversation and, when it is open and the member's or unassigned, hands the worker a
 * candidate with the contact's name, never the text. The worker decides about focus and dedupe.
 * Also opens the conversation in place when the worker asks after a click. Returns the stop.
 */
export function startNotifier({
  workspaceId,
  workspaceName,
  accountId,
  navigate,
}: NotifierOptions): () => void {
  const evaluate = async (conversationId: string, messageId: string) => {
    if (readState(accountId, workspaceId) !== 'on') return;
    try {
      const row = await getConversation(workspaceId, conversationId, { background: true });
      if (row.status !== 'open') return;
      if (row.assignee && row.assignee.account_id !== accountId) return;
      await post({
        type: 'candidate',
        workspaceId,
        workspaceName,
        conversationId,
        messageId,
        contactName: [row.contact.first_name, row.contact.last_name].filter(Boolean).join(' '),
        url: conversationPath(workspaceId, conversationId),
      });
    } catch {
      // A failed read or a missing worker only means no notification this time.
    }
  };

  // A worker the browser lost (cleared site data) would leave an opt-in that is on silent.
  if (readState(accountId, workspaceId) === 'on') void ensureWorker();

  const unsubscribe = subscribeLive(workspaceId, {
    onFrame: (frame) => {
      const message = isNewMessage(frame, workspaceId);
      if (message) void evaluate(message.conversationId, message.messageId);
    },
    onReconnected: () => undefined,
    onClosed: () => undefined,
  });

  const onWorkerMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; workspaceId?: unknown; conversationId?: unknown };
    if (
      data?.type === 'open-conversation' &&
      data.workspaceId === workspaceId &&
      typeof data.conversationId === 'string'
    ) {
      navigate(conversationPath(workspaceId, data.conversationId));
    }
  };
  const container = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  container?.addEventListener('message', onWorkerMessage);

  return () => {
    unsubscribe();
    container?.removeEventListener('message', onWorkerMessage);
  };
}
