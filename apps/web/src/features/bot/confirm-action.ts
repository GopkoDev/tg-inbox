import { ErrorCode, type BotSettings } from '@tg/shared';
import { useRef, useState } from 'react';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { botRefusal, type BotRefusal } from './api';
import { useBotStore } from './store';

const UNEXPECTED = 'Something went wrong — try again';

/**
 * The submit cycle shared by SCR-04 and SCR-05: one request at a time (a second click sends
 * nothing), success replaces the store and closes, Telegram unavailable / anything unexpected
 * shows an alert in the dialog, OWNER_ONLY and the guard states close it. `onRefusal` takes the
 * dialog's own refusals and returns true when it handled (and so closed) them.
 */
export function useConfirmAction({
  workspaceId,
  onClose,
  onRefusal,
}: {
  workspaceId: string;
  onClose: () => void;
  onRefusal: (refusal: BotRefusal) => boolean;
}) {
  const guard = useShellGuard();
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = async (request: () => Promise<BotSettings>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setAlert(null);
    const { replace, markRefused } = useBotStore.getState();
    try {
      replace(workspaceId, await request());
      return onClose();
    } catch (failure) {
      const refusal = botRefusal(failure);
      if (refusal?.code === ErrorCode.TELEGRAM_UNAVAILABLE) {
        setAlert(refusal.message);
      } else if (refusal && onRefusal(refusal)) {
        return;
      } else if (refusal?.code === ErrorCode.OWNER_ONLY) {
        markRefused(workspaceId, 'owners_only');
        return onClose();
      } else {
        try {
          const outcome = await guard(failure, workspaceId);
          if (outcome === 'not-found') markRefused(workspaceId, 'not_found');
          return onClose();
        } catch {
          setAlert(UNEXPECTED);
        }
      }
    } finally {
      inFlight.current = false;
    }
    setSubmitting(false);
  };

  return { submitting, alert, run, busy: inFlight };
}
