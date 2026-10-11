import { ErrorCode } from '@tg/shared';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from './client';

export interface GuardContext {
  navigate: (to: string, state?: { reason: 'session-ended' }) => void;
  /** The address the operator is on now (path + search). */
  currentAddress: () => string;
  /** AC-07 workspace resolution (getMe -> listMyWorkspaces -> land); supplied by the router. */
  resolveWorkspaces: () => Promise<void>;
}

/**
 * The one place that reacts to the workspace guard's answers.
 * Returns `'handled'` (session ended / access removed) or `'not-found'` (render SCR-10 in place);
 * anything else is rethrown for the screen's own error row. Public routes must not call this.
 */
export async function handleGuardError(
  error: unknown,
  ctx: GuardContext,
  workspaceId?: string,
): Promise<'handled' | 'not-found'> {
  if (!(error instanceof ApiError)) throw error;

  if (error.status === 401 && error.code === ErrorCode.UNAUTHENTICATED) {
    const address = ctx.currentAddress();
    useAuthStore.getState().clear();
    useWorkspaceStore.getState().clear();
    useAuthStore.getState().setReturnTo(address);
    ctx.navigate('/sign-in', { reason: 'session-ended' });
    return 'handled';
  }

  if (error.status === 403 && error.code === ErrorCode.ACCESS_REMOVED) {
    const ws = useWorkspaceStore.getState();
    const id = workspaceId ?? ws.current?.id;
    if (ws.current && id === ws.current.id) {
      ws.setAccessRemovedNotice({ workspaceId: id, name: ws.current.name });
      ws.clearWorkspace(id);
    } else if (!ws.current && id && ws.accessRemovedNotice?.workspaceId !== id) {
      // The name is unknown (nothing entered yet): still tell the person (AC-17), but keep a
      // notice that already names this same workspace (a Retry after a failed resolution).
      ws.setAccessRemovedNotice({ workspaceId: id, name: 'this workspace' });
    }
    await ctx.resolveWorkspaces();
    return 'handled';
  }

  if (error.status === 404 && error.code === ErrorCode.NOT_FOUND) return 'not-found';

  throw error;
}
