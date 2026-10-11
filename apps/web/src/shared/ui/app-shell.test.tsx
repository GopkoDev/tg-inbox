import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { openMenu, stubRadixDom } from '@/test/radix';

const signOut = vi.fn();
const getMe = vi.fn();
vi.mock('@/features/auth/api', () => ({ getMe: () => getMe(), signOut: () => signOut() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));

import { AppShell } from './app-shell';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };

function renderShell(path = '/w/w1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/w/:workspaceId"
          element={
            <AppShell>
              <p>shell body</p>
            </AppShell>
          }
        />
        <Route path="/w/:workspaceId/team" element={<p>team screen</p>} />
        <Route
          path="/w/:workspaceId/bot"
          element={
            <AppShell>
              <p>bot body</p>
            </AppShell>
          }
        />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  getMe.mockReturnValue(new Promise(() => undefined));
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

describe('AppShell', () => {
  it('loading: shows a skeleton instead of the workspace name', () => {
    enterWorkspace.mockReturnValue(new Promise(() => undefined));
    renderShell();
    expect(screen.getByTestId('shell-name-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('shell-body-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('shell body')).not.toBeInTheDocument();
  });

  it('shell-level not-found: one main, one h1, no full-page height (AC-13)', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'x'));
    const { container } = renderShell();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelector('main')!.className).not.toContain('min-h-svh');
    expect(container.querySelector('main .min-h-svh')).toBeNull();
    expect(screen.queryByText('shell body')).not.toBeInTheDocument();
  });

  it('owner sees the Team link (AC-15 UI half)', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    const links = screen.getAllByRole('link', { name: 'Team' });
    expect(links[0]).toHaveAttribute('href', '/w/w1/team');
  });

  it('operator sees no Team entry, also not in the phone menu (AC-15 UI half)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    renderShell('/w/w2');
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
    openMenu('Menu');
    expect(screen.queryByRole('menuitem', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('phone menu offers Team to owners', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    openMenu('Menu');
    expect(screen.getByRole('menuitem', { name: 'Team' })).toBeInTheDocument();
  });

  it('account menu shows the email and signs out clearing stores (AC-11)', async () => {
    signOut.mockResolvedValue(undefined);
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    openMenu('o@x.io');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText('sign-in screen')).toBeInTheDocument());
    expect(signOut).toHaveBeenCalled();
    expect(useAuthStore.getState().account).toBeNull();
    expect(useWorkspaceStore.getState().current).toBeNull();
  });

  it('sign-out still reaches sign-in when signOut fails (session already ended)', async () => {
    signOut.mockRejectedValue(new Error('x'));
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    openMenu('o@x.io');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText('sign-in screen')).toBeInTheDocument());
  });

  it('access-removed notice is shown and dismissible (AC-17)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w1', name: 'Acme Flowers' });
    renderShell('/w/w2');
    expect(screen.getByRole('alert')).toHaveTextContent('Your access to Acme Flowers was removed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().accessRemovedNotice).toBeNull();
  });

  it('owner sees Bot right after Team in the desktop nav (SCR-01)', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    const nav = screen.getByRole('navigation');
    const names = within(nav)
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(names).toEqual(['Team', 'Bot']);
    expect(within(nav).getByRole('link', { name: 'Bot' })).toHaveAttribute('href', '/w/w1/bot');
    expect(within(nav).getByRole('link', { name: 'Bot' })).not.toHaveAttribute('aria-current');
  });

  it('phone menu offers Bot after Team to owners', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    openMenu('Menu');
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items.indexOf('Bot')).toBe(items.indexOf('Team') + 1);
    expect(screen.getByRole('menuitem', { name: 'Bot' })).toHaveAttribute('href', '/w/w1/bot');
  });

  it('operator sees no Bot entry, also not in the phone menu (AC-03)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    renderShell('/w/w2');
    expect(screen.queryByRole('link', { name: 'Bot' })).not.toBeInTheDocument();
    openMenu('Menu');
    expect(screen.queryByRole('menuitem', { name: 'Bot' })).not.toBeInTheDocument();
  });

  it('the Bot link is marked current on the bot settings page', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell('/w/w1/bot');
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Bot' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Team' })).not.toHaveAttribute('aria-current');
    // Marked visibly too, not only for assistive technology.
    expect(within(nav).getByRole('link', { name: 'Bot' }).className).toMatch(
      /aria-\[current=page\]:bg-accent/,
    );
  });
});
