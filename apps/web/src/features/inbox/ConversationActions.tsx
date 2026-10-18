import { ChevronDown, Loader2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { cn } from '@/shared/lib/utils';
import { useInboxStore, type ChangeResult } from './store';

export type ActionName = 'close' | 'reopen';

const secondsLeft = (retryAt: string) =>
  Math.max(0, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 1000));

/**
 * SCR-02 actions bar: status badge, assignee button (opens SCR-10 through `onChooseAssignee`),
 * Close / Reopen. One change is in flight per conversation: every control is locked meanwhile.
 * Refusals that open a dialog (stale, needs confirmation) are handed to `onResult`.
 */
export function ConversationActions({
  workspaceId,
  conversationId,
  compact = false,
  onChooseAssignee,
  onResult,
}: {
  workspaceId: string;
  conversationId: string;
  /** Phone: its own row, the assignee button takes the free width. */
  compact?: boolean;
  onChooseAssignee?: () => void;
  onResult?: (action: ActionName, result: ChangeResult) => void;
}) {
  const summary = useInboxStore((s) =>
    s.thread?.conversationId === conversationId ? (s.thread.summary ?? null) : null,
  );
  const [pending, setPending] = useState<ActionName | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!retryAt) return;
    const tick = () => {
      const left = secondsLeft(retryAt);
      setSeconds(left);
      if (left <= 0) setRetryAt(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const wrap = cn('flex flex-col gap-2', compact ? 'w-full px-3 pb-3' : 'items-stretch');
  if (!summary)
    return (
      <div
        data-testid="actions-loading"
        className={cn('flex items-center gap-2', compact && 'w-full')}
      >
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-16" />
      </div>
    );

  const limited = retryAt !== null && seconds > 0;
  const locked = pending !== null || limited;
  const closed = summary.status === 'closed';

  const run = async (action: ActionName) => {
    setPending(action);
    setFailed(false);
    const store = useInboxStore.getState();
    const result =
      action === 'close'
        ? await store.close(workspaceId, conversationId)
        : await store.reopen(workspaceId, conversationId);
    setPending(null);
    if (result.kind === 'limited') {
      setRetryAt(result.retryAt);
      setSeconds(secondsLeft(result.retryAt));
    } else if (result.kind === 'failed') setFailed(true);
    onResult?.(action, result);
  };

  const spinner = <Loader2 data-testid="action-spinner" className="animate-spin" aria-hidden />;
  const assignee = summary.assignee?.display_name ?? 'Unassigned';

  return (
    <div data-testid="conversation-actions" className={wrap}>
      <div className={cn('flex items-center gap-2', compact && 'w-full')}>
        <Badge variant={closed ? 'secondary' : 'outline'}>{closed ? 'Closed' : 'Open'}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={onChooseAssignee}
          className={cn('min-w-0 justify-between', compact && 'flex-1')}
        >
          <UserRound aria-hidden />
          <span className="truncate">{assignee}</span>
          <ChevronDown aria-hidden />
        </Button>
        {closed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => void run('reopen')}
            className="ml-auto"
          >
            {pending === 'reopen' ? spinner : null}
            Reopen
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => void run('close')}
            className="ml-auto"
          >
            {pending === 'close' ? spinner : null}
            Close
          </Button>
        )}
      </div>
      {limited ? (
        <Alert>
          <AlertDescription>
            Changes are limited to 60 per minute — you can continue in {seconds}{' '}
            {seconds === 1 ? 'second' : 'seconds'}
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            Couldn&apos;t save the change — check your connection and try again
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
