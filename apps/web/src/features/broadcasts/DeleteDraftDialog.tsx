import { ErrorCode, type BroadcastDeleted } from '@tg/shared';
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
import { deleteBroadcast } from './api';
import { contactsText } from './AudienceBreakdown';

const NOT_AUTHOR = 'A draft is deleted by its author or a business owner.';

/**
 * SCR-31: deleting a draft (its author or a business owner, AC-07). A launched-meanwhile or gone
 * draft closes the dialog to the host; 401 / ACCESS_REMOVED go to the shell guard.
 */
export function DeleteDraftDialog({
  workspaceId,
  draft,
  onClose,
  onDeleted,
  onLaunched,
  onGone,
}: {
  workspaceId: string;
  /** The draft and its audience size as shown; null = closed. */
  draft: { id: string; audienceSize: number } | null;
  onClose: () => void;
  onDeleted: (answer: BroadcastDeleted) => void;
  onLaunched: () => void;
  onGone: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<'not_author' | 'failed' | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);

  // A newly opened draft starts clean (state adjusted while rendering).
  if (draft && shownFor !== draft.id) {
    setShownFor(draft.id);
    setRefusal(null);
  }

  const close = () => {
    setShownFor(null);
    onClose();
  };

  const confirm = async () => {
    if (!draft) return;
    setPending(true);
    setRefusal(null);
    try {
      const answer = await deleteBroadcast(workspaceId, draft.id);
      setShownFor(null);
      onDeleted(answer);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === ErrorCode.FORBIDDEN) setRefusal('not_author');
      else if (code === ErrorCode.BROADCAST_NOT_A_DRAFT) {
        setShownFor(null);
        onLaunched();
      } else if (code === ErrorCode.NOT_FOUND) {
        setShownFor(null);
        onGone();
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        close();
        void guard(error, workspaceId).catch(() => undefined);
      } else setRefusal('failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={draft !== null}
      onOpenChange={(next) => {
        if (!next && !pending) close();
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
            {`This draft and its audience of ${contactsText(draft?.audienceSize ?? 0)} will be deleted. This can't be undone. Nothing is sent to anyone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal === 'not_author' ? (
          <Alert variant="destructive">
            <AlertDescription>{NOT_AUTHOR}</AlertDescription>
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
                Delete draft
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
