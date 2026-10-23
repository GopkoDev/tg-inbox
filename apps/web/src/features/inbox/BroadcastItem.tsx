import { Megaphone } from 'lucide-react';
import type { ThreadBroadcastItem } from '@tg/shared';
import { Link } from 'react-router';
import { Badge } from '@/shared/ui/badge';

/**
 * SCR-02 (Decision 12): a broadcast that reached this conversation — a centred, full-width block
 * on neither bubble side, so it never reads as a team reply or a customer message. The name links
 * to the broadcast; the text is plain text with its line breaks.
 */
export function BroadcastItem({ item, at }: { item: ThreadBroadcastItem; at: string }) {
  const notConfirmed = item.state === 'not_confirmed';
  return (
    <div
      data-testid="broadcast-item"
      className="mx-auto flex w-full max-w-xl flex-col gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <Megaphone aria-hidden className="size-3.5" />
        <span>Broadcast</span>
        <Link
          to={`/w/${item.workspace_id}/broadcasts/${item.broadcast_id}`}
          className="font-medium text-foreground hover:underline"
        >
          {item.broadcast_name}
        </Link>
        <span>· sent by {item.launched_by.display_name}</span>
      </div>
      <p data-testid="broadcast-item-text" className="break-words whitespace-pre-wrap">
        {item.text}
      </p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {notConfirmed ? (
          <>
            <Badge variant="outline">Not confirmed</Badge>
            <span>sent at {at} — Telegram did not answer</span>
          </>
        ) : (
          <span>{at}</span>
        )}
      </div>
    </div>
  );
}
