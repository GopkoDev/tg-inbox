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
  subscribers: [] as { workspaceId: string; subscriber: unknown }[],
}));
const getAttentionCount = vi.fn();
vi.mock('@/features/attention/api', () => ({
  getAttentionCount: (id: string) => getAttentionCount(id),
}));
vi.mock('@/shared/api/live-connection', () => ({
  openLiveConnection: (workspaceId: string) => {
    const c = { workspaceId, close: vi.fn() };
    live.opened.push(c);
    return c;
  },
  subscribeLive: (workspaceId: string, subscriber: unknown) => {
    const entry = { workspaceId, subscriber };
    live.subscribers.push(entry);
    return () => {
      live.subscribers = live.subscribers.filter((e) => e !== entry);
    };
  },
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
  live.subscribers = [];
  getAttentionCount.mockImplementation(async (id: string) => ({ workspace_id: id, count: 0 }));
  document.title = 'tg-inbox';
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

  it('operator sees the Settings entry too: it leads to their notifications (AC-12)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    renderShell('/w/w2');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/w/w2/settings',
    );
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

  it('operator sees Inbox, Contacts and Settings (AC-12, SCR-15 role: operator)', () => {
    useWorkspaceStore.getState().setCurrent(bolt);
    renderShell('/w/w2');
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Inbox', 'Contacts', 'Settings']);
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

  describe('the attention count (SCR-15, AC-01)', () => {
    const answerWith = (count: number) =>
      getAttentionCount.mockImplementation(async (id: string) => ({ workspace_id: id, count }));
    const frames = () =>
      live.subscribers.map((e) => e.subscriber) as {
        onFrame: (f: unknown) => void;
        onClosed: (code: number) => void;
      }[];
    const badge = () => screen.queryByLabelText(/conversations? needs? you/);

    it('count above 0: the title starts with (N) and Inbox shows N with its label', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(3);
      renderShell();
      await waitFor(() => expect(document.title).toBe('(3) tg-inbox'));
      const nav = screen.getByRole('navigation', { name: 'Workspace' });
      expect(within(nav).getByLabelText('3 conversations need you')).toHaveTextContent('3');
      expect(getAttentionCount).toHaveBeenCalledWith('w1');
    });

    it('is not capped and says conversation for one', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(137);
      const first = renderShell();
      await waitFor(() => expect(document.title).toBe('(137) tg-inbox'));
      expect(screen.getAllByText('137').length).toBeGreaterThan(0);
      first.unmount();
      answerWith(1);
      renderShell();
      expect(await screen.findByLabelText('1 conversation needs you')).toBeInTheDocument();
    });

    it('count 0: plain title and no badge', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(0);
      renderShell();
      await waitFor(() => expect(getAttentionCount).toHaveBeenCalled());
      expect(document.title).toBe('tg-inbox');
      expect(badge()).not.toBeInTheDocument();
    });

    it('loading: no prefix and no badge until the first answer', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      getAttentionCount.mockReturnValue(new Promise(() => undefined));
      renderShell();
      await screen.findByText('shell body');
      expect(document.title).toBe('tg-inbox');
      expect(badge()).not.toBeInTheDocument();
    });

    it('follows the member to another workspace page and keeps one read', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(2);
      renderShell('/w/w1/inbox');
      await waitFor(() => expect(document.title).toBe('(2) tg-inbox'));
      fireEvent.click(await screen.findByRole('link', { name: 'go to settings' }));
      expect(await screen.findByText('bot body')).toBeInTheDocument();
      expect(document.title).toBe('(2) tg-inbox');
      expect(getAttentionCount).toHaveBeenCalledTimes(1);
    });

    it('live: a frame changes the title and the badge within the debounce, without a reload', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(1);
      renderShell();
      await waitFor(() => expect(document.title).toBe('(1) tg-inbox'));
      answerWith(0);
      frames().forEach((f) => f.onFrame({ v: 1, workspace_id: 'w1', type: 'resync' }));
      await waitFor(() => expect(document.title).toBe('tg-inbox'), { timeout: 1000 });
      expect(badge()).not.toBeInTheDocument();
    });

    it('a failed read keeps the last count and shows no error', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(2);
      renderShell();
      await waitFor(() => expect(document.title).toBe('(2) tg-inbox'));
      getAttentionCount.mockRejectedValue(new Error('network'));
      frames().forEach((f) => f.onFrame({ v: 1, workspace_id: 'w1', type: 'resync' }));
      await waitFor(() => expect(getAttentionCount).toHaveBeenCalledTimes(2), { timeout: 1000 });
      expect(document.title).toBe('(2) tg-inbox');
      expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    });

    it('phone: a header Badge after the trigger shows N, hidden from assistive tech and from md up', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(3);
      const { container } = renderShell();
      await waitFor(() => expect(document.title).toBe('(3) tg-inbox'));
      const header = container.querySelector('header')!;
      const mark = within(header).getByText('3');
      expect(mark).toHaveAttribute('aria-hidden', 'true');
      expect(mark).toHaveAttribute('data-slot', 'badge');
      expect(mark.className).toMatch(/md:hidden/);
    });

    it('phone: no header Badge at 0', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(0);
      const { container } = renderShell();
      await waitFor(() => expect(getAttentionCount).toHaveBeenCalled());
      expect(container.querySelector('header [data-slot="badge"]')).toBeNull();
    });

    it('collapsed sidebar: the Inbox tooltip reads Inbox (N)', async () => {
      document.cookie = 'sidebar_state=false; path=/';
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(3);
      renderShell();
      await waitFor(() => expect(document.title).toBe('(3) tg-inbox'));
      fireEvent.focus(screen.getByRole('link', { name: 'Inbox' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Inbox (3)');
      document.cookie = 'sidebar_state=; path=/; max-age=0';
    });

    it('collapsed sidebar at 0: the tooltip is just Inbox', async () => {
      document.cookie = 'sidebar_state=false; path=/';
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(0);
      renderShell();
      await waitFor(() => expect(getAttentionCount).toHaveBeenCalled());
      fireEvent.focus(screen.getByRole('link', { name: 'Inbox' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Inbox$/);
      document.cookie = 'sidebar_state=; path=/; max-age=0';
    });

    it('entering: no count and no prefix', () => {
      enterWorkspace.mockReturnValue(new Promise(() => undefined));
      renderShell();
      expect(getAttentionCount).not.toHaveBeenCalled();
      expect(document.title).toBe('tg-inbox');
    });

    it('not found: no read, no prefix', async () => {
      enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'x'));
      renderShell();
      await screen.findByText('Page not found');
      expect(getAttentionCount).not.toHaveBeenCalled();
      expect(document.title).toBe('tg-inbox');
    });

    it('access removed: the count and the prefix go', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(3);
      renderShell();
      await waitFor(() => expect(document.title).toBe('(3) tg-inbox'));
      getAttentionCount.mockRejectedValue(new ApiError(403, 'ACCESS_REMOVED' as never, 'x'));
      frames().forEach((f) => f.onClosed(4403));
      await waitFor(() => expect(document.title).toBe('tg-inbox'));
      expect(badge()).not.toBeInTheDocument();
    });

    it('a workspace switch clears the count until the new workspace answers', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      enterWorkspace.mockImplementation(async (id: string) => (id === 'w1' ? acme : bolt));
      answerWith(3);
      renderShell();
      await waitFor(() => expect(document.title).toBe('(3) tg-inbox'));
      getAttentionCount.mockReturnValue(new Promise(() => undefined));
      fireEvent.click(await screen.findByRole('link', { name: 'go to bolt' }));
      await waitFor(() => expect(document.title).toBe('tg-inbox'));
      expect(getAttentionCount).toHaveBeenLastCalledWith('w2');
    });

    it('leaving the frame restores the plain title', async () => {
      useWorkspaceStore.getState().setCurrent(acme);
      answerWith(3);
      const { unmount } = renderShell();
      await waitFor(() => expect(document.title).toBe('(3) tg-inbox'));
      unmount();
      expect(document.title).toBe('tg-inbox');
    });
  });
});
