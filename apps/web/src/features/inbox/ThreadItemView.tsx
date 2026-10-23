import type { ThreadItem } from '@tg/shared';
import { Skeleton } from '@/shared/ui/skeleton';
import { ActivityLine } from './ActivityLine';
import { MessageBubble } from './MessageBubble';
import { MessageContent } from './MessageContent';
import { ReplyDeliveryState } from './ReplyDeliveryState';

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * One item of a conversation's history: a customer message, a team reply with its delivery state,
 * or an activity line. `readOnly` (the contact profile) shows the delivery state without the
 * resend buttons, because that view acts on nothing.
 */
export function ThreadItemView({
  item,
  workspaceId,
  contactName,
  readOnly = false,
}: {
  item: ThreadItem;
  workspaceId: string;
  contactName: string;
  readOnly?: boolean;
}) {
  // Broadcast items are rendered by BroadcastItem (broadcasts T37); none reach the thread before it.
  if (item.type === 'broadcast') return null;
  if (item.type === 'activity')
    return <ActivityLine activity={item} at={timeOf(item.position_at)} />;
  if (item.type === 'reply')
    return (
      <MessageBubble
        sender="operator"
        text={item.body}
        at={timeOf(item.sent_at ?? item.position_at)}
        author={item.author.display_name}
        footer={<ReplyDeliveryState reply={item} workspaceId={workspaceId} readOnly={readOnly} />}
      />
    );
  const at = timeOf(item.sent_at);
  return (
    <MessageBubble
      sender="customer"
      at={at}
      edited={item.edited_at !== null}
      content={
        <MessageContent
          message={item}
          workspaceId={workspaceId}
          contactName={contactName}
          at={at}
        />
      }
    />
  );
}

/** Placeholder bubbles while a history loads. */
export function BubbleSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="bubble-skeleton"
          className={i % 2 === 0 ? 'flex justify-start' : 'flex justify-end'}
        >
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
      ))}
    </>
  );
}
