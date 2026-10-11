import { ErrorCode } from '@tg/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { enterWorkspace } from '../api';
import { useGuard } from '../guard';
import { useWorkspaceStore } from '../store';

export type PickError = 'refused' | 'unexpected' | null;

/**
 * Pick a workspace: enter it, make it current (dropping the previous workspace's data, AC-12)
 * and open it. A 404 / ACCESS_REMOVED for the picked one means it is gone: `onRefused` reloads the list.
 */
export function useEnterWorkspace(onRefused: () => void) {
  const navigate = useNavigate();
  const guard = useGuard();
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [error, setError] = useState<PickError>(null);

  async function enter(id: string): Promise<boolean> {
    setEnteringId(id);
    setError(null);
    try {
      const workspace = await enterWorkspace(id);
      useWorkspaceStore.getState().setCurrent(workspace);
      void navigate(`/w/${workspace.id}`);
      return true;
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.status === 404 || (e.status === 403 && e.code === ErrorCode.ACCESS_REMOVED))
      ) {
        setError('refused');
        onRefused();
      } else {
        try {
          await guard(e);
        } catch {
          setError('unexpected');
        }
      }
    } finally {
      setEnteringId(null);
    }
    return false;
  }

  return { enteringId, error, enter };
}
