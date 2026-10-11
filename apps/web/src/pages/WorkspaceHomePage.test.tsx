import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));
const resolveWorkspace = vi.fn();
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));

import { WorkspaceHomePage } from './WorkspaceHomePage';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };

function renderPage(path = '/w/w1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId" element={<WorkspaceHomePage />} />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
        <Route path="*" element={<p>other</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue({
    items: [acme, bolt],
    has_next: false,
    has_prev: false,
    next_cursor: null,
  });
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
});

describe('WorkspaceHomePage (SCR-06)', () => {
  it('loading: header name skeleton while enterWorkspace is in flight', () => {
    enterWorkspace.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('shell-name-skeleton')).toBeInTheDocument();
  });

  it('owner: enters the workspace, shows placeholder and Team link', async () => {
    enterWorkspace.mockResolvedValue(acme);
    renderPage();
    expect(await screen.findByText('Your inbox arrives here')).toBeInTheDocument();
    expect(enterWorkspace).toHaveBeenCalledWith('w1');
    expect(useWorkspaceStore.getState().current).toEqual(acme);
    expect(screen.getAllByRole('link', { name: 'Team' }).length).toBeGreaterThan(0);
  });

  it('operator: no Team link', async () => {
    enterWorkspace.mockResolvedValue(bolt);
    renderPage('/w/w2');
    expect(await screen.findByText('Your inbox arrives here')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('access-removed notice shown under the header (AC-17)', async () => {
    useWorkspaceStore.getState().setAccessRemovedNotice('Acme Flowers');
    enterWorkspace.mockResolvedValue(bolt);
    renderPage('/w/w2');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your access to Acme Flowers was removed',
    );
  });

  it('guard 403 ACCESS_REMOVED: clears data, notice set, resolution re-run (AC-17)', async () => {
    useWorkspaceStore.getState().setCurrent(acme);
    enterWorkspace.mockRejectedValue(new ApiError(403, 'ACCESS_REMOVED' as never, 'gone'));
    resolveWorkspace.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().current).toBeNull();
    expect(useWorkspaceStore.getState().accessRemovedNotice).toBe('Acme Flowers');
  });

  it('guard 401: goes to sign-in', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED' as never, 'no'));
    renderPage();
    expect(await screen.findByText('sign-in screen')).toBeInTheDocument();
  });

  it('guard 404: renders the not-found screen in place', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'nf'));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Your inbox arrives here')).not.toBeInTheDocument();
  });

  it('error: unexpected shows Something went wrong and Retry', async () => {
    enterWorkspace.mockRejectedValueOnce(new Error('net'));
    enterWorkspace.mockResolvedValueOnce(acme);
    renderPage();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Your inbox arrives here')).toBeInTheDocument();
  });
});
