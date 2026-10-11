import { useParams } from 'react-router';
import { Team } from '@/features/workspaces/team/Team';
import { AppShell } from '@/shared/ui/app-shell';

/** SCR-07. Keyed by workspace so switching remounts the body. `onInvite` is filled by T25. */
export function TeamPage({ onInvite }: { onInvite?: () => void } = {}) {
  const { workspaceId = '' } = useParams();
  return (
    <AppShell>
      <h1 className="sr-only">Team</h1>
      <Team key={workspaceId} workspaceId={workspaceId} onInvite={onInvite} />
    </AppShell>
  );
}
