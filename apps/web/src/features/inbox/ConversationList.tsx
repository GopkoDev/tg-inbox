import type { Conversation, LastItem, MessageKind } from '@tg/shared';
import { CornerUpLeft, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { initials } from '@/shared/lib/initials';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Skeleton } from '@/shared/ui/skeleton';
import { relativeTime } from './relative-time';

const KIND_LABEL: Record<MessageKind, string> = {
  text: 'Message',
  photo: 'Photo',
  video: 'Video',
  animation: 'GIF',
  voice: 'Voice message',
  audio: 'Audio',
  video_note: 'Video message',
  document: 'Document',
  sticker: 'Sticker',
  location: 'Location',
  venue: 'Venue',
  contact: 'Contact',
  poll: 'Poll',
  dice: 'Dice',
  other: 'Unsupported message',
};

function previewOf(item: LastItem): string {
  if (item.type === 'reply') return item.body;
  if (item.kind === 'text') return item.body ?? KIND_LABEL.text;
  return item.body ? `${KIND_LABEL[item.kind]} · ${item.body}` : KIND_LABEL[item.kind];
}

export const contactName = (c: Conversation['contact']) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ');

export function ConversationSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="conversation-skeleton"
          className="flex items-center gap-3 px-3 py-3"
        >
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </>
  );
}

export function ConversationList({
  conversations,
  workspaceId,
  selectedId,
  markClosed = false,
}: {
  conversations: Conversation[];
  workspaceId: string;
  selectedId?: string;
  /** Search results hold both statuses: a closed row says so. */
  markClosed?: boolean;
}) {
  const now = new Date();
  return (
    <ul aria-label="Conversations" className="divide-y">
      {conversations.map((c) => {
        const name = contactName(c.contact);
        return (
          <li key={c.id}>
            <Link
              to={`/w/${workspaceId}/inbox/${c.id}`}
              aria-current={c.id === selectedId ? 'true' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-3 hover:bg-accent',
                c.id === selectedId && 'bg-accent',
              )}
            >
              <Avatar>
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {markClosed && c.status === 'closed' ? (
                      <Badge variant="outline" className="shrink-0">
                        Closed
                      </Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(c.last_activity_at, now)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                    {c.last_item.type === 'reply' ? (
                      <CornerUpLeft aria-label="Team reply" className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="truncate">{previewOf(c.last_item)}</span>
                  </span>
                  {c.unread_count > 0 ? (
                    <Badge aria-label={`${c.unread_count} unread`} className="shrink-0">
                      {c.unread_count}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserRound aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{c.assignee?.display_name ?? 'Unassigned'}</span>
                </p>
                {c.waiting_for_reply ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                    Waiting for a reply
                  </p>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
