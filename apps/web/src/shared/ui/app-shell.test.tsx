import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { openMenu, stubRadixDom } from '@/test/radix';
import { InDataRouter } from '@/test/router';

const signOut = vi.fn();
const getMe = vi.fn();
vi.mock('@/features/auth/api', () => ({ getMe: () => getMe(), signOut: () => signOut() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (after?: string) => listMyWorkspaces(after),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));

const live = vi.hoisted(() => ({
  opened: [] as { workspaceId: string; close: () => void }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  openLiveConnection: (workspaceId: string) => {
    const c = { workspaceId, close: vi.fn() };
    live.opened.push(c);
    return c;
  },
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { AppShell } from './app-shell';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };

function renderShell(path = '/w/w1') {
  return render(
    <InDataRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId" element={<AppShell />}>
          <Route
            index
            element={
              <>
                <p>shell body</p>
                <Link to="/w/w2">go to bolt</Link>
              </>
            }
          />
          <Route
            path="inbox"
            element={
              <>
                <p>inbox body</p>
                <Link to="/w/w1/settings/bot">go to settings</Link>
              </>
            }
          />
          <Route path="settings/*" element={<p>bot body</p>} />
        </Route>
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
      </Routes>
    </InDataRouter>,
  );
}

beforeEach(() => {
  live.opened.length = 0;
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

  it('owner sees the Settings link (AC-15 UI half)', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/w/w1/settings',
    );
  });

  it('operator sees no Settings entry (AC-15 UI half)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    renderShell('/w/w2');
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'o@x.io' })).toBeInTheDocument();
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

  it('owner sees Inbox, Contacts and Settings in the nav (SCR-01)', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    const names = within(nav)
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(names).toEqual(['Inbox', 'Contacts', 'Settings']);
    expect(within(nav).getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('operator sees no Settings entry (AC-03)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    renderShell('/w/w2');
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Inbox', 'Contacts']);
  });

  it('the Settings link is marked current on a settings page', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    renderShell('/w/w1/settings/bot');
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current');
    // Marked visibly too, not only for assistive technology.
    expect(within(nav).getByRole('link', { name: 'Settings' }).className).toMatch(
      /aria-\[current=page\]:bg-sidebar-accent/,
    );
  });

  it('S2-6: the sidebar starts expanded, and collapsed when the saved cookie says so', () => {
    useWorkspaceStore.getState().setCurrent(acme);
    document.cookie = 'sidebar_state=; path=/; max-age=0';
    const { container, unmount } = renderShell();
    expect(container.querySelector('[data-slot="sidebar"][data-state]')).toHaveAttribute(
      'data-state',
      'expanded',
    );
    unmount();

    document.cookie = 'sidebar_state=false; path=/';
    const again = renderShell();
    expect(again.container.querySelector('[data-slot="sidebar"][data-state]')).toHaveAttribute(
      'data-state',
      'collapsed',
    );
    document.cookie = 'sidebar_state=; path=/; max-age=0';
  });

  describe('the tab live connection (SAD §4, ADR-0002)', () => {
    it('opens none while the workspace is entering, then exactly one for it once ready', async () => {
      let resolve!: (w: typeof acme) => void;
      enterWorkspace.mockReturnValue(new Promise((r) => (resolve = r)));
      renderShell();
      expect(live.opened).toHaveLength(0);
      resolve(acme);
      expect(await screen.findByText('shell body')).toBeInTheDocument();
      expect(live.opened.map((c) => c.workspaceId)).toEqual(['w1']);
    });

    it('opens none for a workspace the person cannot enter', async () => {
      enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'x'));
      renderShell();
      expect(await screen.findByText('Page not found')).toBeInTheDocument();
      expect(live.opened).toHaveLength(0);
    });

    it('survives navigation between workspace pages', async () => {
      enterWorkspace.mockResolvedValue(acme);
      renderShell('/w/w1/inbox');
      fireEvent.click(await screen.findByRole('link', { name: 'go to settings' }));
      expect(await screen.findByText('bot body')).toBeInTheDocument();
      expect(live.opened).toHaveLength(1);
      expect(live.opened[0]!.close).not.toHaveBeenCalled();
    });

    it('a workspace switch closes the old connection and opens the new one', async () => {
      enterWorkspace.mockImplementation(async (id: string) => (id === 'w1' ? acme : bolt));
      renderShell();
      fireEvent.click(await screen.findByRole('link', { name: 'go to bolt' }));
      await waitFor(() => expect(live.opened.map((c) => c.workspaceId)).toEqual(['w1', 'w2']));
      expect(live.opened[0]!.close).toHaveBeenCalledTimes(1);
      expect(live.opened[1]!.close).not.toHaveBeenCalled();
    });

    it('leaving the frame (sign-out) closes it', async () => {
      enterWorkspace.mockResolvedValue(acme);
      signOut.mockResolvedValue(undefined);
      renderShell();
      await screen.findByText('shell body');
      openMenu('o@x.io');
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
      await waitFor(() => expect(screen.getByText('sign-in screen')).toBeInTheDocument());
      expect(live.opened[0]!.close).toHaveBeenCalledTimes(1);
    });
  });
});
