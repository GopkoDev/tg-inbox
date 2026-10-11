import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';

const signOut = vi.fn();
vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: () => signOut() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));

import { WorkspacesPage } from './WorkspacesPage';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };
const pageOf = (items: unknown[], next: string | null = null) => ({
  items,
  has_next: next !== null,
  has_prev: false,
  next_cursor: next,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/workspaces']}>
      <Routes>
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/w/:id" element={<p>home of picked</p>} />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue(pageOf([acme, bolt]));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
});

describe('WorkspacesPage (SCR-04)', () => {
  it('loading: skeleton while the list is in flight', () => {
    listMyWorkspaces.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('picker-skeleton')).toBeInTheDocument();
  });

  it('default: one row per workspace with a role badge, signed-in email', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Acme Flowers/ })).toHaveTextContent(
      'Business owner',
    );
    expect(screen.getByRole('button', { name: /Bolt Bikes/ })).toHaveTextContent('Operator');
    expect(screen.getByText(/Signed in as o@x\.io/)).toBeInTheDocument();
  });

  it('access-removed notice above the list', async () => {
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w1', name: 'Acme Flowers' });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your access to Acme Flowers was removed',
    );
  });

  it('entering: picked row shows a spinner, others disabled; success opens it', async () => {
    let resolve!: (w: unknown) => void;
    enterWorkspace.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Bolt Bikes/ }));
    expect(screen.getByRole('button', { name: /Acme Flowers/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Bolt Bikes/ })).toBeDisabled();
    expect(screen.getByTestId('entering-spinner')).toBeInTheDocument();
    resolve(bolt);
    await waitFor(() => expect(screen.getByText('home of picked')).toBeInTheDocument());
    expect(enterWorkspace).toHaveBeenCalledWith('w2');
    expect(useWorkspaceStore.getState().current).toEqual(bolt);
  });

  it('pick refused: reloads the list and shows the destructive alert', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'nf'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Bolt Bikes/ }));
    expect(await screen.findByText('That workspace is no longer available')).toBeInTheDocument();
    expect(listMyWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('error: unexpected list failure offers Retry', async () => {
    listMyWorkspaces.mockRejectedValueOnce(new Error('net'));
    renderPage();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Acme Flowers/ })).toBeInTheDocument();
  });

  it('has-more: Show more fetches the next page with the cursor', async () => {
    listMyWorkspaces.mockResolvedValueOnce(pageOf([acme], 'cur1'));
    listMyWorkspaces.mockResolvedValueOnce(pageOf([bolt]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('button', { name: /Bolt Bikes/ })).toBeInTheDocument();
    expect(listMyWorkspaces).toHaveBeenLastCalledWith('cur1');
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('Sign out clears stores and shows sign-in (AC-11)', async () => {
    signOut.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText('sign-in screen')).toBeInTheDocument());
    expect(useAuthStore.getState().account).toBeNull();
  });
});
