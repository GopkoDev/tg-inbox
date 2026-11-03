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
import { movePostBackToDraft } from '../api';

/**
 * SCR-44: moving a scheduled post back to a draft before it is edited (AC-11). Mounted by the
 * host while open; a post that went out meanwhile says so and lets the host refresh.
 */
export function BackToDraftDialog({
  workspaceId,
  postId,
  version,
  onClose,
  onMoved,
  onTooLate,
}: {
  workspaceId: string;
  postId: string;
  version: number;
  onClose: () => void;
  onMoved: () => void;
  onTooLate: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<'too_late' | 'failed' | null>(null);

  const confirm = async () => {
    setPending(true);
    setProblem(null);
    try {
      await movePostBackToDraft(workspaceId, postId, { expected_version: version });
      onMoved();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === ErrorCode.POST_NOT_SCHEDULED) {
        setProblem('too_late');
        onTooLate();
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onClose();
        void guard(error, workspaceId).catch(() => undefined);
      } else setProblem('failed');
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
          <AlertDialogTitle>Move back to drafts?</AlertDialogTitle>
          <AlertDialogDescription>
            It won&apos;t go out unless a business owner schedules or publishes it again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {problem === 'too_late' ? (
          <Alert variant="destructive">
            <AlertDescription>It already went out</AlertDescription>
          </Alert>
        ) : null}
        {problem === 'failed' ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t move the post to drafts</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          {problem === 'too_late' ? (
            <AlertDialogCancel>Close</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button type="button" disabled={pending} onClick={() => void confirm()}>
                {pending ? (
                  <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
                ) : null}
                Move to drafts
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
