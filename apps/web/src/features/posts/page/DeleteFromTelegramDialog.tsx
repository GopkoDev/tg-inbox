import { ErrorCode, type Post } from '@tg/shared';
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
import { deletePostFromTelegram } from '../api';

const REFUSALS: Record<string, string> = {
  [ErrorCode.POST_DELETE_WINDOW_PASSED]: 'The bot can no longer delete this post',
  [ErrorCode.POST_DELETE_REFUSED]: 'Telegram did not let the bot delete it',
  [ErrorCode.TELEGRAM_UNAVAILABLE]: 'Telegram is not responding — try again',
};

/**
 * SCR-41: deleting a published post from Telegram (owners, within 48 hours, AC-15). Mounted by
 * the host while open. A refusal is shown in place; a closed window also asks the host to re-read.
 */
export function DeleteFromTelegramDialog({
  workspaceId,
  postId,
  destinationTitle,
  onClose,
  onDeleted,
  onWindowPassed,
}: {
  workspaceId: string;
  postId: string;
  destinationTitle: string;
  onClose: () => void;
  onDeleted: (post: Post) => void;
  onWindowPassed: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setRefusal(null);
    try {
      const result = await deletePostFromTelegram(workspaceId, postId);
      onDeleted(result.post);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code && REFUSALS[code]) {
        setRefusal(REFUSALS[code]);
        if (code === ErrorCode.POST_DELETE_WINDOW_PASSED) onWindowPassed();
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onClose();
        void guard(error, workspaceId).catch(() => undefined);
      } else setRefusal("Couldn't delete the post — try again");
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent
        {...focus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this post from {destinationTitle}?</AlertDialogTitle>
          <AlertDialogDescription>
            It disappears for everyone in the channel. The post stays here as deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
            ) : null}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
