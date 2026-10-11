import { ErrorCode, type BotIdentity } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { disconnectBot } from '../api';
import { useConfirmAction } from '../confirm-action';
import { useBotStore } from '../store';

interface Props {
  workspaceId: string;
  /** The connected bot; open while non-null. */
  bot: BotIdentity | null;
  onClose: () => void;
}

function ConfirmDisconnectBody({ workspaceId, bot, onClose }: Props & { bot: BotIdentity }) {
  const { submitting, alert, run, busy } = useConfirmAction({
    workspaceId,
    onClose,
    onRefusal: (refusal) => {
      // Stale: the bot was disconnected meanwhile — show what the server holds now.
      if (refusal.code !== ErrorCode.NO_BOT_CONNECTED || !refusal.settings) return false;
      useBotStore.getState().replace(refusal.settings, { tone: 'info', text: refusal.message });
      onClose();
      return true;
    },
  });

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy.current && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect @{bot.username}?</AlertDialogTitle>
          <AlertDialogDescription>
            Messages sent to the bot from now on will never reach tg-inbox. tg-inbox forgets the
            token. Contacts and conversations captured so far stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {alert && (
          <Alert variant="destructive">
            <AlertDescription>{alert}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              void run(() => disconnectBot(workspaceId));
            }}
          >
            {submitting && <Loader2 className="animate-spin" data-testid="disconnect-spinner" />}
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** SCR-05 Confirm disconnect (AC-18). Closing is ignored while the request is in flight. */
export function ConfirmDisconnectDialog({ workspaceId, bot, onClose }: Props) {
  if (!bot) return null;
  return <ConfirmDisconnectBody workspaceId={workspaceId} bot={bot} onClose={onClose} />;
}
