import { ErrorCode, type BroadcastStopped } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useDialogFocus } from '@/features/inbox/StateChangedDialog';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { stopBroadcast } from './api';
import { formatCount } from './AudienceBreakdown';

/**
 * SCR-29: a business owner stops a sending broadcast (AC-18). The waiting count is the page's last
 * read (it may be stale; no second confirmation). A repeat after an error is safe.
 */
export function StopBroadcastDialog({
  workspaceId,
  broadcastId,
  waiting,
  open,
  onClose,
  onAnswered,
  onOwnerOnly,
}: {
  workspaceId: string;
  broadcastId: string;
  waiting: number;
  open: boolean;
  onClose: () => void;
  onAnswered: (answer: BroadcastStopped) => void;
  onOwnerOnly: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = async () => {
    setPending(true);
    setFailed(false);
    try {
      onAnswered(await stopBroadcast(workspaceId, broadcastId));
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.OWNER_ONLY) onOwnerOnly();
      else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onClose();
        void guard(error, workspaceId).catch(() => undefined);
      } else setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const who =
    waiting === 1
      ? '1 recipient is still waiting.'
      : `${formatCount(waiting)} recipients are still waiting.`;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setFailed(false);
          onClose();
        }
      }}
    >
      <AlertDialogContent
        {...focus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this broadcast?</AlertDialogTitle>
          <AlertDialogDescription>
            {`${who} They will not get this message. Sends already on their way finish. A stop can't be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t stop the broadcast</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep sending</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            Stop broadcast
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
