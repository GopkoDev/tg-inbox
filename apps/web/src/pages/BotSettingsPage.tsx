import { useState } from 'react';
import { useParams } from 'react-router';
import {
  PasteTokenDialog,
  type TakeoverHandoff,
} from '@/features/bot/paste-token/PasteTokenDialog';
import { BotSettings, type BotSettingsActions } from '@/features/bot/settings/BotSettings';
import { useBotStore } from '@/features/bot/store';
import { AppShell } from '@/shared/ui/app-shell';

export interface BotSettingsPageProps extends Omit<BotSettingsActions, 'onPasteToken'> {
  /** SCR-04 slot for a paste that needs the takeover confirmation (T26). */
  onPasteTakeover?: (handoff: TakeoverHandoff) => void;
}

interface PasteState {
  /** The workspace the dialog was opened for; a switch elsewhere closes it (and drops the token). */
  workspaceId: string;
  mode: 'connect' | 'new';
  notice: string | null;
}

/**
 * SCR-02 Bot settings with SCR-03 Paste token over it. Keyed by workspace so switching remounts
 * the body. The SCR-04 / SCR-05 slots are filled by T26.
 */
export function BotSettingsPage({
  onDisconnect,
  onTakeoverWarning,
  onPasteTakeover,
}: BotSettingsPageProps = {}) {
  const { workspaceId = '' } = useParams();
  const [paste, setPaste] = useState<PasteState | null>(null);

  const openPaste = (notice?: string) => {
    const state = useBotStore.getState().settings?.state;
    setPaste({
      workspaceId,
      mode: state === 'not_connected' ? 'connect' : 'new',
      notice: notice ?? null,
    });
  };
  const open = paste?.workspaceId === workspaceId ? paste : null;

  return (
    <AppShell>
      <h1 className="mb-3 text-xl font-semibold">Bot</h1>
      <BotSettings
        key={workspaceId}
        workspaceId={workspaceId}
        onPasteToken={openPaste}
        onDisconnect={onDisconnect}
        onTakeoverWarning={onTakeoverWarning}
      />
      <PasteTokenDialog
        workspaceId={workspaceId}
        open={open !== null}
        mode={open?.mode ?? 'connect'}
        notice={open?.notice ?? null}
        onClose={() => setPaste(null)}
        onTakeover={(handoff) => onPasteTakeover?.(handoff)}
      />
    </AppShell>
  );
}
