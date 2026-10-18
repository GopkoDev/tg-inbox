import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';
import { InDataRouter } from '@/test/router';
import { AppShell } from '@/shared/ui/app-shell';

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

function Jump({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(to)}>jump</button>;
}

function renderPage(path = '/w/w1') {
  return render(
    <InDataRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId" element={<AppShell />}>
          <Route index element={<WorkspaceHomePage />} />
        </Route>
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
        <Route path="*" element={<p>other</p>} />
      </Routes>
    </InDataRouter>,
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

  it('owner: enters the workspace, shows placeholder and Settings link', async () => {
    enterWorkspace.mockResolvedValue(acme);
    renderPage();
    expect(await screen.findByText('Your inbox arrives here')).toBeInTheDocument();
    expect(enterWorkspace).toHaveBeenCalledWith('w1');
    expect(useWorkspaceStore.getState().current).toEqual(acme);
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0);
  });

  it('operator: no Settings link', async () => {
    enterWorkspace.mockResolvedValue(bolt);
    renderPage('/w/w2');
    expect(await screen.findByText('Your inbox arrives here')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('access-removed notice shown under the header (AC-17)', async () => {
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w1', name: 'Acme Flowers' });
    enterWorkspace.mockResolvedValue(bolt);
    renderPage('/w/w2');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your access to Acme Flowers was removed',
    );
  });

  it('guard 403 ACCESS_REMOVED: clears data, notice set, resolution re-run (AC-17)', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(403, 'ACCESS_REMOVED' as never, 'gone'));
    resolveWorkspace.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().current).toBeNull();
    expect(useWorkspaceStore.getState().accessRemovedNotice?.name).toBe('this workspace');
  });

  it('guard 401: goes to sign-in', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED' as never, 'no'));
    renderPage();
    expect(await screen.findByText('sign-in screen')).toBeInTheDocument();
  });

  it('guard 404: renders the not-found screen in place', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'nf'));
    renderPage();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to my workspace' })).toBeInTheDocument();
    expect(screen.queryByText('Your inbox arrives here')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Flowers')).not.toBeInTheDocument();
  });

  it('a late response for A after moving to B changes nothing', async () => {
    let resolveA!: (w: typeof acme) => void;
    enterWorkspace.mockImplementation((id: string) =>
      id === 'w1' ? new Promise((r) => (resolveA = r)) : Promise.resolve(bolt),
    );
    render(
      <InDataRouter initialEntries={['/w/w1']}>
        <Routes>
          <Route path="/w/:workspaceId" element={<AppShell />}>
            <Route index element={<WorkspaceHomePage />} />
          </Route>
        </Routes>
        <Jump to="/w/w2" />
      </InDataRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'jump' }));
    await screen.findByRole('button', { name: /Bolt Bikes/ });
    resolveA(acme);
    await new Promise((r) => setTimeout(r, 10));
    expect(useWorkspaceStore.getState().current).toEqual(bolt);
    expect(screen.queryByText('Acme Flowers')).not.toBeInTheDocument();
  });

  it('late 403 for A after moving to B is ignored', async () => {
    let rejectA!: (e: unknown) => void;
    enterWorkspace.mockImplementation((id: string) =>
      id === 'w1' ? new Promise((_, r) => (rejectA = r)) : Promise.resolve(bolt),
    );
    render(
      <InDataRouter initialEntries={['/w/w1']}>
        <Routes>
          <Route path="/w/:workspaceId" element={<AppShell />}>
            <Route index element={<WorkspaceHomePage />} />
          </Route>
        </Routes>
        <Jump to="/w/w2" />
      </InDataRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'jump' }));
    await screen.findByRole('button', { name: /Bolt Bikes/ });
    rejectA(new ApiError(403, 'ACCESS_REMOVED' as never, 'gone'));
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveWorkspace).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().current).toEqual(bolt);
    expect(useWorkspaceStore.getState().accessRemovedNotice).toBeNull();
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
