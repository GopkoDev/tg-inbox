import type { Destination } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
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
import { Button } from '@/shared/ui/button';
import { removeDestination } from '../api';

/** SCR-35: confirms removing a destination; its scheduled posts go back to drafts. */
export function RemoveDestinationDialog({
  workspaceId,
  destination,
  onClose,
  onRemoved,
}: {
  workspaceId: string;
  destination: Destination;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = destination.scheduled_count;

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await removeDestination(workspaceId, destination.id);
      onRemoved();
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'OWNER_ONLY'
          ? 'Only a business owner can remove a channel or group'
          : "Couldn't remove it",
      );
      setPending(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Remove ${destination.title}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {n > 0
              ? `${n} scheduled ${n === 1 ? 'post' : 'posts'} to it go back to drafts. You can connect it again later.`
              : 'You can connect it again later.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
