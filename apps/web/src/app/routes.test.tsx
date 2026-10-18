import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from '@/features/auth/api';
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
vi.mock('@/features/workspaces/resolve', () => ({ resolveWorkspace: vi.fn() }));
// The inbox reads and its live socket are other tasks' business here.
vi.mock('@/features/inbox/store', () => ({
  useInboxStore: Object.assign(() => undefined, {
    getState: () => ({ enter: () => Promise.resolve(), leave: () => undefined }),
  }),
}));
vi.mock('@/features/inbox/InboxList', () => ({ InboxList: () => null }));
// The section bodies are other tasks' business; the route tree is what is under test here.
vi.mock('@/features/workspaces/team/Team', () => ({ Team: () => <p>team body</p> }));
vi.mock('@/features/bot/settings/BotSettings', () => ({ BotSettings: () => <p>bot body</p> }));

import { getSampleContact } from '@/features/contacts/sample-source';
import { resolveWorkspace } from '@/features/workspaces/resolve';
import { routes } from './routes';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'operator' as const };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function setMobile(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { value: mobile ? 500 : 1280, configurable: true });
}

beforeEach(() => {
  stubRadixDom();
  setMobile(false);
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue({
    items: [acme, bolt],
    has_next: false,
    has_prev: false,
    next_cursor: null,
  });
  enterWorkspace.mockImplementation((id: string) => Promise.resolve(id === 'w2' ? bolt : acme));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
});

afterEach(() => setMobile(false));

describe('workspace frame (T3)', () => {
  it('AC-01: entering /w/<id> lands on the inbox inside the sidebar frame', async () => {
    const router = renderAt('/w/w1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/inbox'));

    const inbox = await screen.findByRole('link', { name: 'Inbox' });
    const nav = inbox.closest('nav') as HTMLElement;
    expect(nav).not.toBeNull();
    expect(nav.getAttribute('aria-label')).not.toBe('breadcrumb');
    expect(inbox).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /Acme Flowers/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /o@x\.io/ })).toBeInTheDocument();

    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumbs).getByText('Acme Flowers')).toBeInTheDocument();
    expect(within(crumbs).getByText('Inbox')).toBeInTheDocument();
  });

  it('AC-03: an operator sees Inbox and Contacts but no Settings', async () => {
    renderAt('/w/w2');
    const inbox = await screen.findByRole('link', { name: 'Inbox' });
    expect(inbox).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('AC-11: old /team lands on settings/team', async () => {
    const router = renderAt('/w/w1/team');
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/settings/team'));
    expect(await screen.findByText('team body')).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumbs).getByText('Settings')).toBeInTheDocument();
    expect(within(crumbs).getByText('Team')).toBeInTheDocument();
  });

  it('AC-11: old /bot lands on settings/bot', async () => {
    const router = renderAt('/w/w1/bot');
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/settings/bot'));
    expect(await screen.findByText('bot body')).toBeInTheDocument();
  });

  it('AC-11: /settings lands on settings/bot', async () => {
    const router = renderAt('/w/w1/settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/settings/bot'));
    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumbs).getByText('Settings')).toBeInTheDocument();
    expect(within(crumbs).getByText('Bot')).toBeInTheDocument();
  });

  it('AC-20: pending entry shows the body skeleton and no page content', () => {
    enterWorkspace.mockReturnValue(new Promise(() => undefined));
    renderAt('/w/w1/settings/team');
    expect(screen.getByTestId('shell-body-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('team body')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Inbox' })).not.toBeInTheDocument();
  });

  it('AC-20: a missing workspace shows the not-found card inside the frame', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'x'));
    renderAt('/w/nope/inbox');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toBeInTheDocument();
  });

  it('AC-20: a failed entry shows Something went wrong and Retry recovers', async () => {
    enterWorkspace.mockRejectedValueOnce(new Error('boom'));
    const router = renderAt('/w/w1/inbox');
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Inbox' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/w/w1/inbox');
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('AC-02: on a phone the nav sits behind the trigger and closes after a pick', async () => {
    setMobile(true);
    const router = renderAt('/w/w1/inbox');
    const toggle = await screen.findByRole('button', { name: 'Toggle Sidebar' });
    expect(screen.queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('link', { name: 'Contacts' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/contacts'));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument(),
    );
    await act(async () => undefined);
  });
});

describe('breadcrumb (review fixes)', () => {
  const crumbNav = () => screen.getByRole('navigation', { name: 'breadcrumb' });

  it('S2-1: only the last crumb is the current page (settings/bot)', async () => {
    renderAt('/w/w1/settings/bot');
    await screen.findByText('bot body');
    const current = crumbNav().querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Bot');
    expect(within(crumbNav()).getByRole('link', { name: 'Settings' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('S2-1: only the last crumb is the current page (inbox/<id>)', async () => {
    renderAt('/w/w1/inbox/c1');
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    const current = crumbNav().querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Conversation');
  });

  it('S1-6a: the contact crumb carries the contact name', async () => {
    const c = getSampleContact('ct-01')!;
    renderAt('/w/w1/contacts/ct-01');
    await waitFor(() => expect(within(crumbNav()).getByText(c.name)).toBeInTheDocument());
    expect(within(crumbNav()).getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(within(crumbNav()).queryByText('Contact')).not.toBeInTheDocument();
  });

  it('S1-6a: an unknown id keeps a generic label', async () => {
    renderAt('/w/w1/contacts/nope');
    await waitFor(() => expect(within(crumbNav()).getByText('Contact')).toBeInTheDocument());
  });
});

describe('shell on the inbox route (moved from the former workspace home page)', () => {
  const inboxH1 = () => screen.findByRole('heading', { level: 1, name: 'Inbox' });

  it('owner: enters the workspace of the URL and shows its inbox', async () => {
    renderAt('/w/w1/inbox');
    await inboxH1();
    expect(enterWorkspace).toHaveBeenCalledWith('w1');
    expect(useWorkspaceStore.getState().current).toEqual(acme);
  });

  it('the access-removed notice is shown inside the inset, under the header (AC-17)', async () => {
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w1', name: 'Acme Flowers' });
    renderAt('/w/w2/inbox');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your access to Acme Flowers was removed');
    const header = document.querySelector('header') as HTMLElement;
    expect(header.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header).not.toContainElement(alert);
  });

  it('guard 403 ACCESS_REMOVED: clears data, notice set, resolution re-run (AC-17)', async () => {
    enterWorkspace.mockRejectedValue(new ApiError(403, 'ACCESS_REMOVED' as never, 'gone'));
    vi.mocked(resolveWorkspace).mockResolvedValue(undefined);
    renderAt('/w/w1/inbox');
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().current).toBeNull();
    expect(useWorkspaceStore.getState().accessRemovedNotice?.name).toBe('this workspace');
  });

  it('guard 401: goes to sign-in', async () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => undefined));
    enterWorkspace.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED' as never, 'no'));
    const router = renderAt('/w/w1/inbox');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('a late response for A after moving to B changes nothing', async () => {
    let resolveA!: (w: typeof acme) => void;
    enterWorkspace.mockImplementation((id: string) =>
      id === 'w1' ? new Promise((r) => (resolveA = r)) : Promise.resolve(bolt),
    );
    const router = renderAt('/w/w1/inbox');
    await act(() => router.navigate('/w/w2/inbox'));
    await screen.findByRole('button', { name: /Bolt Bikes/ });
    resolveA(acme);
    await new Promise((r) => setTimeout(r, 10));
    expect(useWorkspaceStore.getState().current).toEqual(bolt);
    expect(screen.queryByText('Acme Flowers')).not.toBeInTheDocument();
  });

  it('a late 403 for A after moving to B is ignored', async () => {
    let rejectA!: (e: unknown) => void;
    enterWorkspace.mockImplementation((id: string) =>
      id === 'w1' ? new Promise((_, r) => (rejectA = r)) : Promise.resolve(bolt),
    );
    const router = renderAt('/w/w1/inbox');
    await act(() => router.navigate('/w/w2/inbox'));
    await screen.findByRole('button', { name: /Bolt Bikes/ });
    rejectA(new ApiError(403, 'ACCESS_REMOVED' as never, 'gone'));
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveWorkspace).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().current).toEqual(bolt);
    expect(useWorkspaceStore.getState().accessRemovedNotice).toBeNull();
  });

  it('A -> B: the previous workspace name leaves the page at once (no residue)', async () => {
    const router = renderAt('/w/w1/inbox');
    await inboxH1();
    expect(screen.getByRole('button', { name: /Acme Flowers/ })).toBeInTheDocument();
    enterWorkspace.mockReturnValue(new Promise(() => undefined));
    await act(() => router.navigate('/w/w2/inbox'));
    expect(screen.queryByText('Acme Flowers')).not.toBeInTheDocument();
  });
});

describe('phone drawer for an operator workspace (S1-7)', () => {
  it('has Inbox and Contacts but no Settings, and the account menu reaches Sign out', async () => {
    setMobile(true);
    renderAt('/w/w2/inbox');
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle Sidebar' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    openMenu(/o@x\.io/);
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    await act(async () => undefined);
  });
});
