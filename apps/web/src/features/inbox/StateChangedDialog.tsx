import type { ConversationSummary, ThreadActivity } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { activityText } from './ActivityLine';
import { relativeTime } from './relative-time';

export type StateChangedAction = 'assign' | 'unassign' | 'reopen';

export function ago(iso: string, now: Date): string {
  const short = relativeTime(iso, now);
  if (short === 'now') return 'just now';
  if (short === 'Yest.') return 'yesterday';
  const minutes = /^(\d+)m$/.exec(short);
  if (minutes) return `${minutes[1]} ${minutes[1] === '1' ? 'minute' : 'minutes'} ago`;
  const hours = /^(\d+)h$/.exec(short);
  if (hours) return `${hours[1]} ${hours[1] === '1' ? 'hour' : 'hours'} ago`;
  return `on ${short}`;
}

/**
 * Focus for a dialog opened without a trigger: Radix moves it onto the Cancel button on open
 * (so a second Enter cannot resend); on close it goes back to whatever had it before, unless
 * the owner says where (`onCloseAutoFocus`, when the opening control is gone).
 */
export function useDialogFocus(onCloseAutoFocus?: (event: Event) => void) {
  const before = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      before.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      if (onCloseAutoFocus) return onCloseAutoFocus(event);
      event.preventDefault();
      before.current?.focus();
    },
  };
}

export const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * SCR-11: the operator acted on a conversation that changed since they looked (AC-03). Shows
 * the state now and the change that made it so; the change happens only on the go-ahead.
 * The parent owns the request: it keeps the pick, resends it with the version it was shown,
 * and replaces `conversation` / `latestChange` (with `again`) when the answer is another refusal.
 */
export function StateChangedDialog({
  open,
  action,
  pickName,
  conversation,
  latestChange,
  again,
  pending,
  failed,
  onLeave,
  onGoAhead,
  onCloseAutoFocus,
  now = new Date(),
}: {
  open: boolean;
  action: StateChangedAction;
  /** The chosen assignee's name, for `assign`. */
  pickName: string | null;
  conversation: ConversationSummary;
  latestChange: ThreadActivity | null;
  again: boolean;
  pending: boolean;
  failed: boolean;
  onLeave: () => void;
  onGoAhead: () => void;
  /** Where focus goes when the dialog closes, when the opening control is gone. */
  onCloseAutoFocus?: (event: Event) => void;
  now?: Date;
}) {
  const focus = useDialogFocus(onCloseAutoFocus);
  const who = conversation.assignee
    ? `assigned to ${conversation.assignee.display_name}`
    : 'unassigned';
  const goAhead =
    action === 'assign'
      ? `Assign to ${pickName ?? ''}`
      : action === 'unassign'
        ? 'Unassign anyway'
        : 'Reopen anyway';
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onLeave();
      }}
    >
      <AlertDialogContent {...focus}>
        <AlertDialogHeader>
          <AlertDialogTitle>This conversation changed since you looked</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-1">
              <p data-testid="state-now">{`Now: ${who} · ${conversation.status === 'closed' ? 'Closed' : 'Open'}`}</p>
              {latestChange ? (
                <p data-testid="latest-change">
                  {`${capitalised(activityText(latestChange))} — ${ago(latestChange.position_at, now)}`}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {again ? (
          <Alert>
            <AlertDescription>It changed again — check before going ahead.</AlertDescription>
          </Alert>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t save the change — try again</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Leave it</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={onGoAhead}>
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            {goAhead}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
