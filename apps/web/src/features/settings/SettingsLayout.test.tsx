import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { SettingsIndexRedirect } from './SettingsIndexRedirect';
import { SettingsLayout } from './SettingsLayout';

const owner = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const operator = { id: 'w1', name: 'Acme Flowers', role: 'operator' as const };

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/w/:workspaceId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsIndexRedirect /> },
          { path: 'bot', element: <p>bot body</p> },
          { path: 'team', element: <p>team body</p> },
          { path: 'tags', element: <p>tags body</p> },
          { path: 'notifications', element: <p>notifications body</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
const menu = () =>
  within(screen.getByRole('navigation', { name: 'Settings' }))
    .getAllByRole('link')
    .map((l) => l.textContent);

beforeEach(() => useWorkspaceStore.getState().clear());

describe('SettingsLayout (SCR-16, Decision 1)', () => {
  it('an owner sees Bot, Team, Tags and Notifications and the full description', () => {
    useWorkspaceStore.getState().setCurrent(owner);
    renderAt('/w/w1/settings/bot');
    expect(menu()).toEqual(['Bot', 'Team', 'Tags', 'Notifications']);
    expect(
      screen.getByText("Manage your workspace's bot, team and tags, and your notifications"),
    ).toBeInTheDocument();
  });

  it('the Tags entry links to settings/tags and is marked current there', () => {
    useWorkspaceStore.getState().setCurrent(owner);
    renderAt('/w/w1/settings/tags');
    const tags = screen.getByRole('link', { name: 'Tags' });
    expect(tags).toHaveAttribute('href', '/w/w1/settings/tags');
    expect(tags).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('tags body')).toBeInTheDocument();
  });

  it('an operator never sees Tags in the menu, even on the Tags address (AC-11)', () => {
    useWorkspaceStore.getState().setCurrent(operator);
    renderAt('/w/w1/settings/tags');
    expect(menu()).toEqual(['Notifications']);
  });

  it('an operator sees Notifications only and the short description', () => {
    useWorkspaceStore.getState().setCurrent(operator);
    renderAt('/w/w1/settings/notifications');
    expect(menu()).toEqual(['Notifications']);
    expect(screen.getByText('Manage your notifications')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('notifications body')).toBeInTheDocument();
  });

  it('the Notifications entry is marked current on its page', () => {
    useWorkspaceStore.getState().setCurrent(owner);
    renderAt('/w/w1/settings/notifications');
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('an operator who opens the Bot address still reaches the section (its own card refuses)', () => {
    useWorkspaceStore.getState().setCurrent(operator);
    renderAt('/w/w1/settings/bot');
    expect(screen.getByText('bot body')).toBeInTheDocument();
  });

  it('the index goes to Bot for an owner', () => {
    useWorkspaceStore.getState().setCurrent(owner);
    const router = renderAt('/w/w1/settings');
    expect(router.state.location.pathname).toBe('/w/w1/settings/bot');
    expect(screen.getByText('bot body')).toBeInTheDocument();
  });

  it('the index goes to Notifications for an operator', () => {
    useWorkspaceStore.getState().setCurrent(operator);
    const router = renderAt('/w/w1/settings');
    expect(router.state.location.pathname).toBe('/w/w1/settings/notifications');
    expect(screen.getByText('notifications body')).toBeInTheDocument();
  });
});
