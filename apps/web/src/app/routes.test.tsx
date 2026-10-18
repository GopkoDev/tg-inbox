import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/features/workspaces/resolve', () => ({ resolveWorkspace: vi.fn() }));
// The section bodies are other tasks' business; the route tree is what is under test here.
vi.mock('@/features/workspaces/team/Team', () => ({ Team: () => <p>team body</p> }));
vi.mock('@/features/bot/settings/BotSettings', () => ({ BotSettings: () => <p>bot body</p> }));

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
