import { ErrorCode, type BotIdentity, type BotSettings } from '@tg/shared';
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
import type { BotRefusal } from '../api';
import { useConfirmAction } from '../confirm-action';

/**
 * What SCR-04 confirms: the bot from `409 TAKEOVER_CONFIRMATION_REQUIRED`, its server message,
 * and the confirming request — `pasteBotToken { token, confirm_takeover: true }` (the token kept
 * only in this closure, in memory) or `reconnectBot { confirm_takeover: true }`.
 */
export interface TakeoverRequest {
  bot: BotIdentity;
  message: string;
  resubmit: () => Promise<BotSettings>;
}

/** Refusals of the confirming request's re-check; the page routes them (SCR-03 / SCR-02). */
const RECHECK_REFUSALS: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.BOT_TOKEN_INVALID,
  ErrorCode.BOT_BELONGS_TO_ANOTHER_WORKSPACE,
  ErrorCode.WORKSPACE_KEEPS_ONE_BOT,
  ErrorCode.BOT_NEEDS_NEW_TOKEN,
  ErrorCode.NOTHING_TO_RECONNECT,
]);

interface Props {
  workspaceId: string;
  /** Open while non-null; closing drops it, and with it the token. */
  request: TakeoverRequest | null;
  onClose: () => void;
  /** A re-check refusal: the dialog has closed, the page shows the refusal where it belongs. */
  onRefused: (refusal: BotRefusal) => void;
}

function ConfirmTakeoverBody({
  workspaceId,
  request,
  onClose,
  onRefused,
}: Omit<Props, 'request'> & { request: TakeoverRequest }) {
  const { submitting, alert, run, busy } = useConfirmAction({
    workspaceId,
    onClose,
    onRefusal: (refusal) => {
      if (!RECHECK_REFUSALS.has(refusal.code)) return false;
      onClose();
      onRefused(refusal);
      return true;
    },
  });

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy.current && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take over @{request.bot.username}?</AlertDialogTitle>
          <AlertDialogDescription>
            {request.message}. Only do this if you no longer use that service.
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
              void run(request.resubmit);
            }}
          >
            {submitting && <Loader2 className="animate-spin" data-testid="takeover-spinner" />}
            Connect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** SCR-04 Confirm takeover (AC-06, AC-16b). Closing is ignored while the request is in flight. */
export function ConfirmTakeoverDialog({ workspaceId, request, onClose, onRefused }: Props) {
  if (!request) return null;
  return (
    <ConfirmTakeoverBody
      workspaceId={workspaceId}
      request={request}
      onClose={onClose}
      onRefused={onRefused}
    />
  );
}
