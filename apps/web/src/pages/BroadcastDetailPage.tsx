import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useBroadcastDraftStore } from '@/features/broadcasts/draft-store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { NotFoundCard } from './NotFoundPage';

/**
 * One broadcast address (`/broadcasts/:id`, `/broadcasts/:id/launch`, `/broadcasts/new`): the
 * draft view (SCR-25, the editor of T31) while the read answers a draft, the read-only page
 * (SCR-28, T35) once it is launched, the not-found card for an unknown or foreign id.
 */
export function BroadcastDetailPage() {
  const { workspaceId = '', broadcastId } = useParams();
  const guard = useShellGuard();
  const status = useBroadcastDraftStore((s) => (s.broadcastId === broadcastId ? s.status : 'idle'));
  const draft = useBroadcastDraftStore((s) => (s.broadcastId === broadcastId ? s.draft : null));
  const launched = useBroadcastDraftStore((s) =>
    s.broadcastId === broadcastId ? s.launched : null,
  );

  useEffect(() => {
    if (!broadcastId) return;
    const store = useBroadcastDraftStore.getState();
    void store.open(workspaceId, broadcastId, guard);
    const stop = store.watch(workspaceId, guard);
    return () => {
      stop();
      useBroadcastDraftStore.getState().close();
    };
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, broadcastId]);

  if (!broadcastId)
    return (
      <section data-testid="broadcast-draft-view" className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">New broadcast</h1>
      </section>
    );
  if (status === 'not_found') return <NotFoundCard />;
  if (status === 'error')
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load the broadcast
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void useBroadcastDraftStore.getState().open(workspaceId, broadcastId, guard)
            }
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (status === 'launched' && launched)
    return (
      <section data-testid="broadcast-launched-view" className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold break-words">{launched.name}</h1>
      </section>
    );
  if (status === 'ready' && draft)
    return (
      <section data-testid="broadcast-draft-view" className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold break-words">{draft.name}</h1>
      </section>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="broadcast-skeleton">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
