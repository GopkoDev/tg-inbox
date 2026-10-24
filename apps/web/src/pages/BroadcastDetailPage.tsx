import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { BroadcastEditor } from '@/features/broadcasts/BroadcastEditor';
import { BroadcastPage } from '@/features/broadcasts/BroadcastPage';
import { useBroadcastDraftStore } from '@/features/broadcasts/draft-store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
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
  /** The draft view was shown at this address: a later launch or delete came while it was open. */
  const [shownDraft, setShownDraft] = useState<string | null>(null);
  if (status === 'ready' && draft && broadcastId && shownDraft !== broadcastId) {
    setShownDraft(broadcastId);
  }
  const wasDraft = broadcastId !== undefined && shownDraft === broadcastId;

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

  if (!broadcastId) return <BroadcastEditor key="new" workspaceId={workspaceId} />;
  if (status === 'not_found')
    return wasDraft ? (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">This draft was deleted.</p>
        <NotFoundCard />
      </div>
    ) : (
      <NotFoundCard />
    );
  if (status === 'error')
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Couldn&apos;t load this broadcast
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
      <BroadcastPage
        key={broadcastId}
        workspaceId={workspaceId}
        broadcastId={broadcastId}
        notice={
          wasDraft ? (
            <Alert>
              <AlertDescription>
                This broadcast was launched and can no longer be changed.
              </AlertDescription>
            </Alert>
          ) : undefined
        }
      />
    );
  if (status === 'ready' && draft)
    return (
      <BroadcastEditor key={broadcastId} workspaceId={workspaceId} broadcastId={broadcastId} />
    );
  return (
    <div className="flex flex-col gap-4" data-testid="broadcast-skeleton">
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} data-testid="editor-skeleton">
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
