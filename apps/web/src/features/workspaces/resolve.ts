import type { Me } from '@tg/shared';
import { getMe } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { listMyWorkspaces } from './api';

export type Navigate = (to: string) => void;

/**
 * AC-07: where does a signed-in operator land?
 * return address -> last used workspace (if still active) -> the only workspace
 * -> picker (several) -> no-access (none). Throws the ApiError of getMe / listMyWorkspaces
 * (e.g. 401) for the caller to handle.
 */
export async function resolveWorkspace(navigate: Navigate, loadedMe?: Me): Promise<void> {
  const me = loadedMe ?? (await getMe());
  const auth = useAuthStore.getState();
  auth.setAccount(me.account);

  const { items } = await listMyWorkspaces();

  const returnTo = auth.returnTo;
  if (returnTo) {
    auth.setReturnTo(null);
    navigate(returnTo);
    return;
  }
  const last = items.find((w) => w.id === me.last_used_workspace_id);
  if (last) return navigate(`/w/${last.id}`);
  const [only] = items;
  if (items.length === 1 && only) return navigate(`/w/${only.id}`);
  navigate(items.length > 1 ? '/workspaces' : '/no-access');
}
