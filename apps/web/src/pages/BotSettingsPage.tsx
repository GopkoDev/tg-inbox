import { ErrorCode, type BotIdentity } from '@tg/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { pasteBotToken, reconnectBot, type BotRefusal } from '@/features/bot/api';
import { ConfirmDisconnectDialog } from '@/features/bot/confirm-disconnect/ConfirmDisconnectDialog';
import {
  ConfirmTakeoverDialog,
  type TakeoverRequest,
} from '@/features/bot/confirm-takeover/ConfirmTakeoverDialog';
import {
  PasteTokenDialog,
  type TakeoverHandoff,
} from '@/features/bot/paste-token/PasteTokenDialog';
import { BotSettings } from '@/features/bot/settings/BotSettings';
import { useBotStore } from '@/features/bot/store';
import { AppShell } from '@/shared/ui/app-shell';

interface PasteState {
  /** The workspace the dialog was opened for; a switch elsewhere closes it (and drops the token). */
  workspaceId: string;
  mode: 'connect' | 'new';
  notice: string | null;
}

/** An open SCR-04 / SCR-05, bound to the workspace it was opened for. */
interface Scoped<T> {
  workspaceId: string;
  value: T;
}

/**
 * SCR-02 Bot settings with its dialogs: SCR-03 Paste token, SCR-04 Confirm takeover and SCR-05
 * Confirm disconnect. Keyed by workspace so switching remounts the body. A pasted token waiting
 * for the takeover confirmation lives only in the SCR-04 request's closure; closing drops it.
 */
export function BotSettingsPage() {
  const { workspaceId = '' } = useParams();
  const [paste, setPaste] = useState<PasteState | null>(null);
  const [takeover, setTakeover] = useState<Scoped<TakeoverRequest> | null>(null);
  const [disconnect, setDisconnect] = useState<Scoped<BotIdentity> | null>(null);

  const openPaste = (notice?: string) => {
    const state = useBotStore.getState().settings?.state;
    setPaste({
      workspaceId,
      mode: state === 'not_connected' ? 'connect' : 'new',
      notice: notice ?? null,
    });
  };
  /** A dialog opened for another workspace is closed here (a switch drops it). */
  const here = <T extends { workspaceId: string }>(open: T | null) =>
    open?.workspaceId === workspaceId ? open : null;
  const openPasteState = here(paste);

  const onPasteTakeover = ({ token, bot, message }: TakeoverHandoff) =>
    setTakeover({
      workspaceId,
      value: {
        bot,
        message,
        resubmit: () => pasteBotToken(workspaceId, { token, confirm_takeover: true }),
      },
    });

  const onReconnectTakeover = (bot: BotIdentity, message: string) =>
    setTakeover({
      workspaceId,
      value: {
        bot,
        message,
        resubmit: () => reconnectBot(workspaceId, { confirm_takeover: true }),
      },
    });

  /** A refusal of the confirming request: back to SCR-03 (paste) or SCR-02 (reconnect). */
  const onTakeoverRefused = (refusal: BotRefusal) => {
    const { replace } = useBotStore.getState();
    if (refusal.code === ErrorCode.NOTHING_TO_RECONNECT && refusal.settings) {
      replace(refusal.settings, { tone: 'info', text: refusal.message });
      return;
    }
    if (refusal.code === ErrorCode.BOT_NEEDS_NEW_TOKEN && refusal.settings) {
      replace(refusal.settings);
    }
    openPaste(refusal.message);
  };

  return (
    <AppShell>
      <h1 className="mb-3 text-xl font-semibold">Bot</h1>
      <BotSettings
        key={workspaceId}
        workspaceId={workspaceId}
        onPasteToken={openPaste}
        onDisconnect={(bot) => setDisconnect({ workspaceId, value: bot })}
        onTakeoverWarning={onReconnectTakeover}
      />
      <PasteTokenDialog
        workspaceId={workspaceId}
        open={openPasteState !== null}
        mode={openPasteState?.mode ?? 'connect'}
        notice={openPasteState?.notice ?? null}
        onClose={() => setPaste(null)}
        onTakeover={onPasteTakeover}
      />
      <ConfirmTakeoverDialog
        workspaceId={workspaceId}
        request={here(takeover)?.value ?? null}
        onClose={() => setTakeover(null)}
        onRefused={onTakeoverRefused}
      />
      <ConfirmDisconnectDialog
        workspaceId={workspaceId}
        bot={here(disconnect)?.value ?? null}
        onClose={() => setDisconnect(null)}
      />
    </AppShell>
  );
}
