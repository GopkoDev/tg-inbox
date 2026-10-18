import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { relativeTime } from './relative-time';

function ago(iso: string, now: Date): string {
  const short = relativeTime(iso, now);
  if (short === 'now') return 'just now';
  if (short === 'Yest.') return 'yesterday';
  return /^\d+[mh]$/.test(short) ? `${short} ago` : `on ${short}`;
}

/** SCR-04: confirm sending over a teammate's reply the operator had not seen when typing began. */
export function TeammateRepliedDialog({
  open,
  author,
  positionAt,
  pending,
  failed,
  onKeepEditing,
  onSendAnyway,
  now = new Date(),
}: {
  open: boolean;
  author: string;
  positionAt: string;
  pending: boolean;
  failed: boolean;
  onKeepEditing: () => void;
  onSendAnyway: () => void;
  now?: Date;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onKeepEditing();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>A teammate just replied</AlertDialogTitle>
          <AlertDialogDescription>
            {`${author} replied to this customer ${ago(positionAt, now)}. Send your reply anyway?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Your reply was not sent — try again</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button type="button" disabled={pending} onClick={onSendAnyway}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Send anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
