import type { Me, WorkspaceSummaryPage } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';

const getMe = vi.fn<() => Promise<Me>>();
const listMyWorkspaces = vi.fn<() => Promise<WorkspaceSummaryPage>>();
vi.mock('@/features/auth/api', () => ({ getMe: () => getMe() }));
vi.mock('./api', () => ({ listMyWorkspaces: () => listMyWorkspaces() }));

import { resolveWorkspace } from './resolve';

const account = { id: 'a1', email: 'o@x.io', display_name: 'O' };
const ws = (id: string) => ({ id, name: `W ${id}`, role: 'operator' as const });
const page = (ids: string[]): WorkspaceSummaryPage => ({
  items: ids.map(ws),
  has_next: false,
  has_prev: false,
  next_cursor: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.getState().clear();
});

describe('resolveWorkspace (AC-07, AC-10)', () => {
  it('opens the remembered return address first', async () => {
    getMe.mockResolvedValue({ account, last_used_workspace_id: 'w1' });
    listMyWorkspaces.mockResolvedValue(page(['w1', 'w2']));
    useAuthStore.getState().setReturnTo('/w/w2/team');
    const navigate = vi.fn();
    await resolveWorkspace(navigate);
    expect(navigate).toHaveBeenCalledWith('/w/w2/team');
    expect(useAuthStore.getState().returnTo).toBeNull();
    expect(useAuthStore.getState().account).toEqual(account);
  });

  it('opens the last used workspace when still active', async () => {
    getMe.mockResolvedValue({ account, last_used_workspace_id: 'w2' });
    listMyWorkspaces.mockResolvedValue(page(['w1', 'w2']));
    const navigate = vi.fn();
    await resolveWorkspace(navigate);
    expect(navigate).toHaveBeenCalledWith('/w/w2');
  });

  it('opens the only workspace when the last used one is gone', async () => {
    getMe.mockResolvedValue({ account, last_used_workspace_id: 'gone' });
    listMyWorkspaces.mockResolvedValue(page(['w1']));
    const navigate = vi.fn();
    await resolveWorkspace(navigate);
    expect(navigate).toHaveBeenCalledWith('/w/w1');
  });

  it('shows the picker for several workspaces without a usable last one', async () => {
    getMe.mockResolvedValue({ account, last_used_workspace_id: null });
    listMyWorkspaces.mockResolvedValue(page(['w1', 'w2']));
    const navigate = vi.fn();
    await resolveWorkspace(navigate);
    expect(navigate).toHaveBeenCalledWith('/workspaces');
  });

  it('goes to no-access when there are no active memberships', async () => {
    getMe.mockResolvedValue({ account, last_used_workspace_id: 'w1' });
    listMyWorkspaces.mockResolvedValue(page([]));
    const navigate = vi.fn();
    await resolveWorkspace(navigate);
    expect(navigate).toHaveBeenCalledWith('/no-access');
  });

  it('uses an already loaded Me without calling getMe again', async () => {
    listMyWorkspaces.mockResolvedValue(page(['w1']));
    const navigate = vi.fn();
    await resolveWorkspace(navigate, { account, last_used_workspace_id: null });
    expect(getMe).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/w/w1');
  });
});
