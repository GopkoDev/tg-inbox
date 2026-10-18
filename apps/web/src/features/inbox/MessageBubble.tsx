import { cn } from '@/shared/lib/utils';

export function MessageBubble({
  sender,
  text,
  at,
}: {
  sender: 'customer' | 'operator';
  text: string;
  at: string;
}) {
  const mine = sender === 'operator';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        <p className="break-words whitespace-pre-wrap">{text}</p>
        <p
          className={cn(
            'mt-1 text-xs',
            mine ? 'text-primary-foreground/70' : 'text-muted-foreground',
          )}
        >
          {at}
        </p>
      </div>
    </div>
  );
}
