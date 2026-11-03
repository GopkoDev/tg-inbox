import { ErrorCode } from '@tg/shared';
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
import { deletePostDraft } from '../api';

/**
 * SCR-42: deleting a draft (its author or a business owner, AC-18). Mounted by the host while
 * open. A post that is no longer a draft is handed back to the host; 401 / ACCESS_REMOVED go to
 * the shell guard.
 */
export function DeletePostDialog({
  workspaceId,
  postId,
  onClose,
  onDeleted,
  onNotADraft,
}: {
  workspaceId: string;
  postId: string;
  onClose: () => void;
  onDeleted: () => void;
  onNotADraft: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<'not_author' | 'failed' | null>(null);

  const confirm = async () => {
    setPending(true);
    setRefusal(null);
    try {
      await deletePostDraft(workspaceId, postId);
      onDeleted();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === ErrorCode.FORBIDDEN) setRefusal('not_author');
      else if (code === ErrorCode.POST_NOT_A_DRAFT) onNotADraft();
      else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onClose();
        void guard(error, workspaceId).catch(() => undefined);
      } else setRefusal('failed');
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
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            This can&apos;t be undone. Nothing is sent to anyone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal === 'not_author' ? (
          <Alert variant="destructive">
            <AlertDescription>
              Only the author or a business owner can delete this draft
            </AlertDescription>
          </Alert>
        ) : null}
        {refusal === 'failed' ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t delete the draft</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          {refusal === 'not_author' ? (
            <AlertDialogCancel>Close</AlertDialogCancel>
          ) : (
            <>
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
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
