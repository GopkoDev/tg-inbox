import { useCallback, useEffect, useState } from 'react';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { enterWorkspace } from '../api';
import { useWorkspaceStore } from '../store';

type Status = 'loading' | 'ready' | 'error' | 'not-found';

/** SCR-06 body: enters the workspace of the URL on open, then shows the placeholder. */
export function WorkspaceHome({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);

  const enter = useCallback(async (): Promise<Status> => {
    // The previous workspace's data goes before this one renders (AC-12).
    const previous = useWorkspaceStore.getState().current;
    if (previous && previous.id !== workspaceId) {
      useWorkspaceStore.getState().clearWorkspace(previous.id);
    }
    try {
      const workspace = await enterWorkspace(workspaceId);
      useWorkspaceStore.getState().setCurrent(workspace);
      return 'ready';
    } catch (error) {
      try {
        return (await guard(error, workspaceId)) === 'not-found' ? 'not-found' : 'loading';
      } catch {
        return 'error';
      }
    }
  }, [guard, workspaceId]);

  useEffect(() => {
    let live = true;
    void enter().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [enter, attempt]);

  if (status === 'not-found') return <NotFoundPage />;
  if (status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-2">
          Something went wrong
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setStatus('loading');
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (status === 'loading') return null;
  return (
    <Card>
      <CardContent>
        <p className="text-muted-foreground">Your inbox arrives here</p>
      </CardContent>
    </Card>
  );
}
