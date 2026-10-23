import { ErrorCode, type TagDeleted, type TagWithCount } from '@tg/shared';
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
import { deleteTag } from './api';

export const contactsText = (n: number) => `${n} ${n === 1 ? 'contact' : 'contacts'}`;

/** The count the dialog shows and sends; `again` after a `TAG_COUNT_CHANGED`. */
interface Shown {
  tagId: string;
  count: number;
  again: boolean;
}

/**
 * SCR-23: the delete confirmation. It sends the count it shows (`expected_count`); on
 * `409 TAG_COUNT_CHANGED` nothing was deleted and it asks again with the current number. Gone
 * and owners-only refusals are the host's (SCR-21); 401 / ACCESS_REMOVED go to the shell guard.
 */
export function DeleteTagDialog({
  workspaceId,
  tag,
  onClose,
  onDeleted,
  onGone,
  onOwnerOnly,
}: {
  workspaceId: string;
  /** The tag to delete, as the list shows it; null = closed. */
  tag: TagWithCount | null;
  onClose: () => void;
  onDeleted: (answer: TagDeleted, tag: TagWithCount) => void;
  onGone: () => void;
  onOwnerOnly: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // A newly opened tag starts from the list's count (state adjusted while rendering).
  if (tag && shown?.tagId !== tag.id) {
    setShown({ tagId: tag.id, count: tag.contact_count, again: false });
    setFailed(false);
  }
  const count = shown?.tagId === tag?.id && shown ? shown.count : (tag?.contact_count ?? 0);

  const close = () => {
    setShown(null);
    onClose();
  };

  const confirm = async () => {
    if (!tag) return;
    setPending(true);
    setFailed(false);
    try {
      const answer = await deleteTag(workspaceId, tag.id, { expected_count: count });
      setShown(null);
      onDeleted(answer, tag);
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.TAG_COUNT_CHANGED) {
        const now = (error.details as { tag?: TagWithCount } | undefined)?.tag;
        setShown({ tagId: tag.id, count: now?.contact_count ?? count, again: true });
      } else if (error instanceof ApiError && error.code === ErrorCode.TAG_NOT_FOUND) {
        setShown(null);
        onGone();
      } else if (error instanceof ApiError && error.code === ErrorCode.OWNER_ONLY) {
        setShown(null);
        onOwnerOnly();
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setShown(null);
        onClose();
        void guard(error, workspaceId).catch(() => undefined);
      } else setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={tag !== null}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <AlertDialogContent {...focus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete «${tag?.name ?? ''}»?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 0
              ? 'No contact carries it. This cannot be undone.'
              : `It will be removed from ${contactsText(count)}. Each of them keeps a note in its tag history. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {shown?.again ? (
          <Alert>
            <AlertDescription>
              The number of contacts changed since you opened this.
            </AlertDescription>
          </Alert>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t delete the tag — try again.</AlertDescription>
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
            Delete tag
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
