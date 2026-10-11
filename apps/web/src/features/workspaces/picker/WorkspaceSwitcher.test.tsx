import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { openMenu, stubRadixDom } from '@/test/radix';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));

import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };
const list = { items: [acme, bolt], has_next: false, has_prev: false, next_cursor: null };

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue(list);
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useWorkspaceStore.getState().setCurrent(acme);
  useWorkspaceStore.getState().setData('inbox', ['acme-thread']);
});

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/w/w1']}>
      <Routes>
        <Route path="/w/:workspaceId" element={<WorkspaceSwitcher />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WorkspaceSwitcher (AC-12)', () => {
  it('lists workspaces with the current one checked', async () => {
    renderSwitcher();
    openMenu('Acme Flowers');
    expect(await screen.findByRole('menuitem', { name: /Bolt Bikes/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Acme Flowers/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('switching enters the new workspace and drops the old workspace data', async () => {
    enterWorkspace.mockResolvedValue(bolt);
    renderSwitcher();
    openMenu('Acme Flowers');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Bolt Bikes/ }));
    await waitFor(() => expect(useWorkspaceStore.getState().current).toEqual(bolt));
    expect(enterWorkspace).toHaveBeenCalledWith('w2');
    expect(useWorkspaceStore.getState().data).toEqual({});
  });

  it('a refused pick reloads the list and says the workspace is gone', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'nf'));
    renderSwitcher();
    openMenu('Acme Flowers');
    fireEvent.click(await screen.findByRole('menuitem', { name: /Bolt Bikes/ }));
    expect(await screen.findByText('That workspace is no longer available')).toBeInTheDocument();
    expect(listMyWorkspaces.mock.calls.length).toBeGreaterThan(1);
    expect(useWorkspaceStore.getState().current).toEqual(acme);
  });
});
