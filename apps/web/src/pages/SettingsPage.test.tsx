import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useBotStore } from '@/features/bot/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (a?: string) => listMyWorkspaces(a),
  enterWorkspace: (id: string) => enterWorkspace(id),
}));
vi.mock('@/features/workspaces/resolve', () => ({ resolveWorkspace: vi.fn() }));
// The Team body is T5's business; here only the section menu reaching it matters.
vi.mock('@/features/workspaces/team/Team', () => ({ Team: () => <p>team body</p> }));
const getBotSettings = vi.fn();
vi.mock('@/features/bot/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/bot/api')>()),
  getBotSettings: (w: string, o?: unknown) => getBotSettings(w, o),
}));

import { routes } from '@/app/routes';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const bot = { name: 'Acme Flowers Support', username: 'acme_flowers_bot' };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue({ items: [acme], has_next: false, has_prev: false });
  enterWorkspace.mockResolvedValue(acme);
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useBotStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'Olga' });
});

describe('SettingsPage (SCR-11)', () => {
  it('AC-07: an owner opens Settings on the Bot section with title, description and menu', async () => {
    getBotSettings.mockResolvedValue({
      state: 'connected',
      bot,
      last_checked_at: '2026-10-11T10:03:00.000Z',
      last_message_received_at: '2026-10-11T09:58:12.000Z',
      contacts_count: 12,
    });
    renderAt('/w/w1/settings');

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText("Manage your workspace's bot and team")).toBeInTheDocument();

    const menu = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(menu).getByRole('link', { name: 'Bot' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('link', { name: 'Team' })).not.toHaveAttribute('aria-current');

    expect(await screen.findByText('Acme Flowers Support')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@acme_flowers_bot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('AC-07: the Team entry of the section menu opens the Team section', async () => {
    getBotSettings.mockResolvedValue({ state: 'not_connected' });
    const router = renderAt('/w/w1/settings');
    const menu = await screen.findByRole('navigation', { name: 'Settings' });

    fireEvent.click(within(menu).getByRole('link', { name: 'Team' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/settings/team'));
    expect(await screen.findByText('team body')).toBeInTheDocument();
    const after = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(after).getByRole('link', { name: 'Team' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(after).getByRole('link', { name: 'Bot' })).not.toHaveAttribute('aria-current');
  });

  it('AC-10: an operator refused the bot sees the refusal and a way back to the inbox', async () => {
    getBotSettings.mockRejectedValue(
      new ApiError(403, 'OWNER_ONLY' as never, 'Only business owners manage the bot'),
    );
    const router = renderAt('/w/w1/settings/bot');

    expect(await screen.findByText('Only business owners manage the bot')).toBeInTheDocument();
    expect(screen.queryByText('Acme Flowers Support')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/w1/inbox'));
  });
});
