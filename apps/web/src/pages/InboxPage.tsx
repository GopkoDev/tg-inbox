import { useParams } from 'react-router';
import { InboxPreview } from '@/features/inbox/InboxPreview';
import { getSampleConversation } from '@/features/inbox/sample-source';
import { SampleDataBadge } from '@/shared/ui/sample-data-badge';
import { NotFoundCard } from './NotFoundPage';

/** SCR-08: the inbox preview on sample data; an unknown conversation shows the frame's not-found card. */
export function InboxPage() {
  const { conversationId } = useParams();
  if (conversationId && !getSampleConversation(conversationId))
    return <NotFoundCard headingLevel={1} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <SampleDataBadge />
      </div>
      <InboxPreview />
    </div>
  );
}
