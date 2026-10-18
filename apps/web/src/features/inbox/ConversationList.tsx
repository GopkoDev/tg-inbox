import { Link } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import type { SampleConversation } from './sample-source';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function ConversationList({
  conversations,
  workspaceId,
  selectedId,
}: {
  conversations: SampleConversation[];
  workspaceId: string;
  selectedId?: string;
}) {
  return (
    <ul aria-label="Conversations" className="divide-y">
      {conversations.map((c) => (
        <li key={c.id}>
          <Link
            to={`/w/${workspaceId}/inbox/${c.id}`}
            aria-current={c.id === selectedId ? 'true' : undefined}
            className={cn(
              'hover:bg-accent flex items-center gap-3 px-3 py-3',
              c.id === selectedId && 'bg-accent',
            )}
          >
            <Avatar>
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{c.at}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground truncate text-sm">{c.lastMessage}</span>
                {c.unread > 0 ? <Badge className="shrink-0">{c.unread}</Badge> : null}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
