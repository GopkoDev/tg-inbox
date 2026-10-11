import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { enterWorkspace } from './api';
import type { GuardFn } from './guard';
import { useWorkspaceStore } from './store';

export type UrlWorkspaceStatus = 'entering' | 'ready' | 'error' | 'not-found';

/**
 * The one place that enters the workspace named in the address (AC-12/AC-13/AC-17): whenever the
 * current workspace is not the URL's, the previous one is dropped before paint and the URL's is
 * entered. Results for an address the person has already left are ignored.
 */
export function useWorkspaceFromUrl(workspaceId: string, guard: GuardFn) {
  const current = useWorkspaceStore((s) => s.current);
  const [failure, setFailure] = useState<{ id: string; kind: 'error' | 'not-found' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const guardRef = useRef(guard);

  useLayoutEffect(() => {
    guardRef.current = guard;
  });

  useLayoutEffect(() => {
    const previous = useWorkspaceStore.getState().current;
    if (workspaceId && previous && previous.id !== workspaceId) {
      useWorkspaceStore.getState().clearWorkspace(previous.id);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || useWorkspaceStore.getState().current?.id === workspaceId) return;
    let live = true;
    enterWorkspace(workspaceId).then(
      (workspace) => {
        if (live && workspace.id === workspaceId) {
          useWorkspaceStore.getState().setCurrent(workspace);
        }
      },
      async (error: unknown) => {
        if (!live) return;
        try {
          const outcome = await guardRef.current(error, workspaceId);
          if (live && outcome === 'not-found') setFailure({ id: workspaceId, kind: 'not-found' });
        } catch {
          if (live) setFailure({ id: workspaceId, kind: 'error' });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId, attempt]);

  const status: UrlWorkspaceStatus =
    current?.id === workspaceId ? 'ready' : failure?.id === workspaceId ? failure.kind : 'entering';

  const retry = () => {
    setFailure(null);
    setAttempt((n) => n + 1);
  };
  return { status, retry };
}
