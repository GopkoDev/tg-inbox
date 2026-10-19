import { ChevronDown, Loader2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CloseReason, ConversationSummary, ThreadActivity } from '@tg/shared';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { cn } from '@/shared/lib/utils';
import { AssigneeChooser } from './AssigneeChooser';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import { StateChangedDialog } from './StateChangedDialog';
import { useInboxStore, type ChangeResult } from './store';

export type ActionName = 'close' | 'reopen' | 'assign' | 'unassign';

const secondsLeft = (retryAt: string) =>
  Math.max(0, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 1000));

/** SCR-11 while open: the refusal on screen and the request it will resend on the go-ahead. */
interface Confirm {
  action: 'assign' | 'unassign' | 'reopen';
  pick: string | null;
  pickName: string | null;
  conversation: ConversationSummary;
  latestChange: ThreadActivity | null;
  again: boolean;
  failed: boolean;
}

/** SCR-12 while open: the reasons the server gave for the close it refused. */
interface CloseAsk {
  reasons: CloseReason[];
  staleChange: ThreadActivity | null;
  newestUnreadMessage: { id: string; received_at: string } | null;
  again: boolean;
  failed: boolean;
  /** What the refusal was about: «Close anyway» confirms exactly this, not a later live summary. */
  expected: Pick<ConversationSummary, 'state_version' | 'close_snapshot'>;
}

/**
 * SCR-02 actions bar: status badge, assignee button (opens SCR-10, the AssigneeChooser),
 * Close / Reopen. One change is in flight per conversation: every control is locked meanwhile.
 * Refusals that open a dialog (stale, needs confirmation) are handed to `onResult`.
 */
export function ConversationActions({
  workspaceId,
  conversationId,
  compact = false,
  onResult,
}: {
  workspaceId: string;
  conversationId: string;
  /** Phone: its own row, the assignee button takes the free width. */
  compact?: boolean;
  /** `pick` is the chosen assignee id (null = unassign) for assign / unassign: SCR-11 keeps it. */
  onResult?: (action: ActionName, result: ChangeResult, pick?: string | null) => void;
}) {
  const summary = useInboxStore((s) =>
    s.thread?.conversationId === conversationId ? (s.thread.summary ?? null) : null,
  );
  const [pending, setPending] = useState<ActionName | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [closeAsk, setCloseAsk] = useState<CloseAsk | null>(null);
  const [refusal, setRefusal] = useState(0);
  const assigneeButton = useRef<HTMLButtonElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

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

  const run = async (
    action: ActionName,
    pick: string | null = null,
    pickName: string | null = null,
    fromDialog = false,
  ): Promise<ChangeResult> => {
    setPending(action);
    setFailed(false);
    const store = useInboxStore.getState();
    const result =
      action === 'close'
        ? await store.close(
            workspaceId,
            conversationId,
            fromDialog ? { confirm: true, expected: closeAsk?.expected } : {},
          )
        : action === 'reopen'
          ? await store.reopen(workspaceId, conversationId)
          : action === 'assign' && pick
            ? await store.assign(workspaceId, conversationId, pick)
            : await store.unassign(workspaceId, conversationId);
    setPending(null);
    if (result.kind === 'limited') {
      setRetryAt(result.retryAt);
      setSeconds(secondsLeft(result.retryAt));
    } else if (result.kind === 'failed' && !fromDialog) setFailed(true);
    if (action === 'close') {
      const asked = useInboxStore.getState().thread?.summary;
      if (result.kind === 'needs_confirmation' && asked)
        setCloseAsk({
          expected: { state_version: asked.state_version, close_snapshot: asked.close_snapshot },
          reasons: result.reasons,
          staleChange: result.staleChange,
          newestUnreadMessage: result.newestUnreadMessage,
          again: fromDialog,
          failed: false,
        });
      else if (fromDialog) {
        if (result.kind === 'failed') setCloseAsk((c) => (c ? { ...c, failed: true } : c));
        else setCloseAsk(null);
      }
    } else {
      if (result.kind === 'stale') {
        // The store already holds the newer summary; the dialog keeps its own copy (Decision 7).
        const now = useInboxStore.getState().thread?.summary;
        if (now)
          setConfirm({
            action,
            pick,
            pickName,
            conversation: now,
            latestChange: result.latestChange,
            again: fromDialog,
            failed: false,
          });
      } else if (fromDialog) {
        if (result.kind === 'failed') setConfirm((c) => (c ? { ...c, failed: true } : c));
        else {
          setConfirm(null);
          if (result.kind === 'assignee_not_active') setRefusal((n) => n + 1);
        }
      }
    }
    if (action === 'assign' || action === 'unassign') onResult?.(action, result, pick);
    else onResult?.(action, result);
    return result;
  };

  const spinner = <Loader2 data-testid="action-spinner" className="animate-spin" aria-hidden />;
  const assignee = summary.assignee?.display_name ?? 'Unassigned';

  return (
    <div data-testid="conversation-actions" className={wrap}>
      <div className={cn('flex items-center gap-2', compact && 'w-full')}>
        <Badge variant={closed ? 'secondary' : 'outline'}>{closed ? 'Closed' : 'Open'}</Badge>
        <AssigneeChooser
          workspaceId={workspaceId}
          assigneeId={summary.assignee?.account_id ?? null}
          refusal={refusal}
          onPick={(pick, name) => run(pick ? 'assign' : 'unassign', pick, name)}
        >
          <Button
            ref={assigneeButton}
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            className={cn('min-w-0 justify-between', compact && 'flex-1')}
          >
            <UserRound aria-hidden />
            <span className="truncate">{assignee}</span>
            <ChevronDown aria-hidden />
          </Button>
        </AssigneeChooser>
        {closed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            ref={reopenButton}
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
            ref={closeButton}
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
      {confirm ? (
        <StateChangedDialog
          open
          action={confirm.action}
          pickName={confirm.pickName}
          conversation={confirm.conversation}
          latestChange={confirm.latestChange}
          again={confirm.again}
          failed={confirm.failed}
          pending={pending !== null}
          onLeave={() => setConfirm(null)}
          onGoAhead={() => void run(confirm.action, confirm.pick, confirm.pickName, true)}
          onCloseAutoFocus={(event) => {
            // The control that opened it may have been replaced (a closed chooser row).
            event.preventDefault();
            (confirm.action === 'reopen' ? reopenButton : assigneeButton).current?.focus();
          }}
        />
      ) : null}
      {closeAsk ? (
        <CloseConfirmDialog
          open
          reasons={closeAsk.reasons}
          staleChange={closeAsk.staleChange}
          newestUnreadMessage={closeAsk.newestUnreadMessage}
          again={closeAsk.again}
          failed={closeAsk.failed}
          pending={pending !== null}
          onKeep={() => setCloseAsk(null)}
          onCloseAnyway={() => void run('close', null, null, true)}
          onCloseAutoFocus={(event) => {
            // Close may have been replaced by Reopen once the conversation closed.
            event.preventDefault();
            (closeButton.current ?? reopenButton.current)?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
