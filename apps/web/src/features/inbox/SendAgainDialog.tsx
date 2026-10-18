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

export type SendAgainProblem = 'confirmation' | 'failed' | null;

/** SCR-05: warn that a "not confirmed" reply may reach the customer twice before sending it again. */
export function SendAgainDialog({
  open,
  pending,
  problem,
  onCancel,
  onSendAgain,
}: {
  open: boolean;
  pending: boolean;
  problem: SendAgainProblem;
  onCancel: () => void;
  onSendAgain: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send this reply again?</AlertDialogTitle>
          <AlertDialogDescription>
            tg-inbox could not confirm that it reached the customer. If it did, the customer will
            receive it twice.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>
              {problem === 'confirmation'
                ? 'Confirm that you want to send it again'
                : 'Something went wrong — try again'}
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={onSendAgain}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Send again
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
