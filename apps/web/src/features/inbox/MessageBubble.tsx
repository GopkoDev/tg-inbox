import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * A chat bubble. `text` is the plain-text content for now; `content` replaces it (T26 fills
 * message kinds) and `footer` is the delivery-state slot under a reply (T28).
 */
export function MessageBubble({
  sender,
  text,
  at,
  author,
  edited = false,
  content,
  footer,
}: {
  sender: 'customer' | 'operator';
  text?: string;
  at: string;
  author?: string;
  edited?: boolean;
  content?: ReactNode;
  footer?: ReactNode;
}) {
  const mine = sender === 'operator';
  const muted = mine ? 'text-primary-foreground/70' : 'text-muted-foreground';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        data-testid="bubble"
        className={cn(
          'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {author ? <p className={cn('mb-1 text-xs font-medium', muted)}>{author}</p> : null}
        {content ?? <p className="break-words whitespace-pre-wrap">{text}</p>}
        <p className={cn('mt-1 flex gap-1 text-xs', muted)}>
          <span>{at}</span>
          {edited ? <span>edited</span> : null}
        </p>
        {footer}
      </div>
    </div>
  );
}
