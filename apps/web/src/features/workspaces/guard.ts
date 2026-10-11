import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { handleGuardError } from '@/shared/api/guard';
import { resolveWorkspace } from './resolve';

/** Binds the shared guard handler to the router; supplied to workspace-area screens by AppShell. */
export function useGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const address = location.pathname + location.search;
  return useCallback(
    (error: unknown, workspaceId?: string) =>
      handleGuardError(
        error,
        {
          navigate: (to, state) => void navigate(to, { replace: true, state }),
          currentAddress: () => address,
          resolveWorkspaces: () => resolveWorkspace((to) => void navigate(to, { replace: true })),
        },
        workspaceId,
      ),
    [navigate, address],
  );
}

export type GuardFn = ReturnType<typeof useGuard>;
