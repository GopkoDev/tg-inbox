import { useParams } from 'react-router';
import { AppShell } from '@/shared/ui/app-shell';

/** SCR-02 Bot settings. Keyed by workspace so switching remounts the body; filled by T24–T26. */
export function BotSettingsPage() {
  const { workspaceId = '' } = useParams();
  return (
    <AppShell>
      <h1 key={workspaceId} className="text-xl font-semibold">
        Bot
      </h1>
    </AppShell>
  );
}
