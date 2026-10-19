import type { CloseReason, ThreadActivity } from '@tg/shared';
import { Loader2 } from 'lucide-react';
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
import { ago, capitalised, useDialogFocus } from './StateChangedDialog';

/** One line per reason; the two unread reasons point at the same message, so they share one. */
function lines(
  reasons: CloseReason[],
  staleChange: ThreadActivity | null,
  unread: { received_at: string } | null,
  now: Date,
): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const hasUnread = reasons.includes('unread_customer_message');
  const hasNew = reasons.includes('new_customer_message');
  if (hasUnread || hasNew) {
    const when = hasUnread
      ? unread
        ? ` — ${ago(unread.received_at, now)}`
        : ''
      : ' — since you opened it';
    out.push({ key: 'unread', text: `A customer message arrived that you haven't read${when}` });
  }
  for (const reason of reasons) {
    if (reason === 'customer_waiting')
      out.push({ key: reason, text: 'The customer is waiting for a reply' });
    else if (reason === 'reply_not_delivered')
      out.push({ key: reason, text: 'The latest reply was not delivered' });
    else if (reason === 'reply_not_confirmed')
      out.push({
        key: reason,
        text: 'The latest reply was not confirmed — it may not have reached the customer',
      });
    else if (reason === 'state_changed')
      out.push({
        key: reason,
        text: staleChange
          ? `It changed since you looked: ${capitalised(activityText(staleChange))} — ${ago(staleChange.position_at, now)}`
          : 'It changed since you looked',
      });
  }
  return out;
}

/**
 * SCR-12: closing would put a conversation out of sight over something the operator may not
 * have seen (AC-06, AC-08). Lists every reason the server gave; nothing is evaluated here. The
 * parent owns the request: it resends the refusal's version and snapshot on «Close anyway» and
 * replaces `reasons` (with `again`) when the answer is another refusal.
 */
export function CloseConfirmDialog({
  open,
  reasons,
  staleChange,
  newestUnreadMessage,
  again,
  pending,
  failed,
  onKeep,
  onCloseAnyway,
  onCloseAutoFocus,
  now = new Date(),
}: {
  open: boolean;
  reasons: CloseReason[];
  staleChange: ThreadActivity | null;
  newestUnreadMessage: { received_at: string } | null;
  again: boolean;
  pending: boolean;
  failed: boolean;
  onKeep: () => void;
  onCloseAnyway: () => void;
  /** Where focus goes when the dialog closes, when the opening control is gone. */
  onCloseAutoFocus?: (event: Event) => void;
  now?: Date;
}) {
  const focus = useDialogFocus(onCloseAutoFocus);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onKeep();
      }}
    >
      <AlertDialogContent {...focus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Close this conversation?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-1">
              <p>It may be too early:</p>
              <ul className="list-disc pl-5">
                {lines(reasons, staleChange, newestUnreadMessage, now).map((line) => (
                  <li key={line.key}>{line.text}</li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {again ? (
          <Alert>
            <AlertDescription>
              Something changed while you were deciding — check again.
            </AlertDescription>
          </Alert>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t close the conversation — try again</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it open</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={onCloseAnyway}>
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            Close anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
