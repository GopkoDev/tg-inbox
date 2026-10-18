import { contactName } from './ConversationList';
import { useInboxStore } from './store';

/** Breadcrumb label of an open conversation: the contact's name, «Conversation» until it is known. */
export function ConversationCrumb({
  params,
}: {
  params: Readonly<Record<string, string | undefined>>;
}) {
  const name = useInboxStore((s) => {
    const open =
      s.thread && s.thread.conversationId === params.conversationId ? s.thread.contact : null;
    const contact = open ?? s.conversations.find((c) => c.id === params.conversationId)?.contact;
    return contact ? contactName(contact) : null;
  });
  return <>{name || 'Conversation'}</>;
}
