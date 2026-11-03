import { ErrorCode, type BroadcastLaunched, type LaunchConfirmation } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { ScrollArea } from '@/shared/ui/scroll-area';
import { Skeleton } from '@/shared/ui/skeleton';
import { getLaunchConfirmation, launchBroadcast } from './api';
import { AudienceBreakdown, contactsText } from './AudienceBreakdown';
import { RefusalAlert, launchRefusalOf, type LaunchRefusal } from './launch-refusal';

const WARNING =
  'Customers who did not expect this message can block or report the bot. That can limit the bot for support too.';
const NOTICES = {
  audience: 'The contacts this broadcast would reach changed. Check the number and confirm again.',
  draft: 'This draft was changed by a teammate. Check the text and number and confirm again.',
} as const;

type Stop = LaunchRefusal | { kind: 'no_text' };

/**
 * SCR-27 (AC-06, AC-07, AC-09, AC-10): the launch confirmation at `/broadcasts/<id>/launch`. Shows
 * the text exactly as the customer will see it, how many it goes to and who is left out, and the
 * warning; the launch sends exactly the version and fingerprint shown — the first confirmation, or
 * the one an asks-again answer carried — never a recomputed one, and only once at a time.
 */
export function LaunchConfirmDialog({
  workspaceId,
  broadcastId,
  open,
  confirmation,
  onCancel,
  onLaunched,
  onOwnersOnly,
  returnFocus,
}: {
  workspaceId: string;
  broadcastId: string;
  open: boolean;
  /** Null while the confirmation is read (the dialog shows skeleton lines). */
  confirmation: LaunchConfirmation | null;
  onCancel: () => void;
  /** Launched now or before (`already_launched`, or a draft no longer a draft). */
  onLaunched: (answer: BroadcastLaunched | null) => void;
  onOwnersOnly: () => void;
  /** Where focus goes once the dialog closes (the editor's Launch). */
  returnFocus?: () => void;
}) {
  const guard = useShellGuard();
  const [shown, setShown] = useState<LaunchConfirmation | null>(confirmation);
  const [seen, setSeen] = useState<LaunchConfirmation | null>(confirmation);
  const [notice, setNotice] = useState<keyof typeof NOTICES | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  // A confirmation read by the host replaces the one shown (state adjusted while rendering).
  if (confirmation !== seen) {
    setSeen(confirmation);
    setShown(confirmation);
    setNotice(null);
    setStop(null);
    setFailed(false);
  }

  /** Refusals that end the confirmation; false when `error` is not one. */
  const refused = (error: unknown) => {
    const refusal = launchRefusalOf(error);
    if (refusal) {
      setStop(refusal);
      return true;
    }
    const code = error instanceof ApiError ? error.code : null;
    if (code === ErrorCode.BROADCAST_TEXT_INVALID) {
      setStop({ kind: 'no_text' });
      return true;
    }
    if (code === ErrorCode.OWNER_ONLY) {
      onOwnersOnly();
      return true;
    }
    if (code === ErrorCode.BROADCAST_NOT_A_DRAFT) {
      onLaunched(null);
      return true;
    }
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      onCancel();
      void guard(error, workspaceId);
      return true;
    }
    return false;
  };

  const confirm = async () => {
    if (inFlight.current || !shown) return;
    inFlight.current = true;
    const sent = { expected_version: shown.version, fingerprint: shown.fingerprint };
    setPending(true);
    setFailed(false);
    setNotice(null);
    try {
      onLaunched(await launchBroadcast(workspaceId, broadcastId, sent));
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === ErrorCode.BROADCAST_AUDIENCE_CHANGED) {
        const current = (error as ApiError & { details: { confirmation: LaunchConfirmation } })
          .details.confirmation;
        setShown(current);
        setNotice('audience');
      } else if (code === ErrorCode.BROADCAST_DRAFT_CHANGED) {
        try {
          setShown(await getLaunchConfirmation(workspaceId, broadcastId));
          setNotice('draft');
        } catch (again) {
          if (!refused(again)) setFailed(true);
        }
      } else if (!refused(error)) setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const count = shown?.breakdown.recipient_count ?? 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent
        className="flex max-h-[90dvh] flex-col"
        onOpenAutoFocus={(event) => {
          // Cancel first (an irreversible send, screens.md Decision 13).
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('[data-launch-cancel]')
            ?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return;
          event.preventDefault();
          returnFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Send this broadcast?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {shown ? (
              <p>
                This message goes to <strong>{contactsText(count)}</strong> from your business bot:
              </p>
            ) : (
              <Skeleton data-testid="launch-skeleton" className="h-4 w-64" />
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {shown ? (
          <>
            <ScrollArea className="max-h-72 min-h-0 flex-1 rounded-md border">
              <p
                data-testid="launch-text"
                className="px-3 py-2 text-sm break-words whitespace-pre-wrap"
              >
                {shown.text}
              </p>
            </ScrollArea>
            <AudienceBreakdown breakdown={shown.breakdown} reachLabel="Would reach" />
            <Alert>
              <AlertDescription>{WARNING}</AlertDescription>
            </Alert>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} data-testid="launch-skeleton" className="h-4 w-full" />
            ))}
          </div>
        )}
        {notice ? (
          <Alert>
            <AlertDescription>{NOTICES[notice]}</AlertDescription>
          </Alert>
        ) : null}
        {stop?.kind === 'no_text' ? (
          <Alert variant="destructive">
            <AlertDescription>Write the text before launching</AlertDescription>
          </Alert>
        ) : stop ? (
          <RefusalAlert refusal={stop} botSettingsHref={`/w/${workspaceId}/settings/bot`} />
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn&apos;t send the broadcast. Nothing was sent.</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter data-testid="launch-footer">
          {stop ? (
            <AlertDialogCancel data-launch-cancel>Close</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel data-launch-cancel disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <Button type="button" disabled={pending || !shown} onClick={() => void confirm()}>
                {pending ? (
                  <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
                ) : null}
                {`Send to ${contactsText(count)}`}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
