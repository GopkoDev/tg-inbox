import { Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { BroadcastsTable } from '@/features/broadcasts/BroadcastsTable';
import { Button } from '@/shared/ui/button';

/** SCR-24: the workspace's broadcasts; keyed by workspace so a switch starts fresh. */
export function BroadcastsPage() {
  const { workspaceId = '' } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Broadcasts</h1>
        <Button asChild className="w-full sm:w-auto">
          <Link to={`/w/${workspaceId}/broadcasts/new`}>
            <Plus aria-hidden />
            New broadcast
          </Link>
        </Button>
      </div>
      <BroadcastsTable key={workspaceId} workspaceId={workspaceId} />
    </div>
  );
}
