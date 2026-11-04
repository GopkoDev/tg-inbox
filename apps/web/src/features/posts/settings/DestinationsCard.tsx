import type { Destination, DestinationProblem } from '@tg/shared';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';

const PROBLEM: Record<DestinationProblem, string> = {
  no_post_right: 'Give the bot the right to post messages',
  not_member: 'The bot is no longer in this chat',
  chat_gone: 'This chat no longer exists',
  not_current_bot: 'Connected with your previous bot — connect it again',
};

/** SCR-33 list of destinations; `onRemove` is given only to an owner. */
export function DestinationsCard({
  items,
  onRemove,
}: {
  items: Destination[];
  onRemove?: (destination: Destination) => void;
}) {
  return (
    <Card>
      <CardContent className="divide-y">
        {items.map((d) => (
          <div key={d.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.title}</span>
                <Badge variant="secondary">{d.kind === 'channel' ? 'Channel' : 'Group'}</Badge>
                {d.username && <span className="text-sm text-muted-foreground">@{d.username}</span>}
                {d.availability === 'available' ? (
                  <Badge variant="outline">Available</Badge>
                ) : (
                  <Badge variant="destructive">Can't post</Badge>
                )}
              </div>
              {d.availability === 'unavailable' && d.problem && (
                <p className="text-sm text-muted-foreground">{PROBLEM[d.problem]}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{`${d.scheduled_count} scheduled`}</span>
              {onRemove && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${d.title}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRemove(d)}>Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
