import { useParams } from 'react-router';
import { WorkspaceHome } from '@/features/workspaces/home/WorkspaceHome';

/** SCR-06. Keyed by workspace so switching remounts the body and re-enters. */
export function WorkspaceHomePage() {
  const { workspaceId = '' } = useParams();
  return (
    <>
      <h1 className="sr-only">Workspace home</h1>
      <WorkspaceHome key={workspaceId} />
    </>
  );
}
