import { useParams } from 'react-router';
import { BotSettings, type BotSettingsActions } from '@/features/bot/settings/BotSettings';
import { AppShell } from '@/shared/ui/app-shell';

/**
 * SCR-02 Bot settings. Keyed by workspace so switching remounts the body. The dialog slots
 * (SCR-03 paste token, SCR-04 takeover, SCR-05 disconnect) are filled by T25–T26.
 */
export function BotSettingsPage(actions: BotSettingsActions = {}) {
  const { workspaceId = '' } = useParams();
  return (
    <AppShell>
      <h1 className="mb-3 text-xl font-semibold">Bot</h1>
      <BotSettings key={workspaceId} workspaceId={workspaceId} {...actions} />
    </AppShell>
  );
}
