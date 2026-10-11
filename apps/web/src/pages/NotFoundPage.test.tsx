import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';

const resolveWorkspace = vi.fn();
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));

vi.mock('@/features/workspaces/api', () => ({
  enterWorkspace: (id: string) => Promise.resolve({ id, name: 'Acme Flowers', role: 'owner' }),
  listMyWorkspaces: () =>
    Promise.resolve({ items: [], has_next: false, has_prev: false, next_cursor: null }),
  listMemberships: () =>
    Promise.resolve({ items: [], has_next: false, has_prev: false, next_cursor: null }),
  listPendingInvitations: () =>
    Promise.resolve({ items: [], has_next: false, has_prev: false, next_cursor: null }),
}));

import { createMemoryRouter, RouterProvider } from 'react-router';
import { useAuthStore } from '@/features/auth/store';
import { NotFoundPage } from './NotFoundPage';

beforeEach(() => {
  vi.resetAllMocks();
  resolveWorkspace.mockResolvedValue(undefined);
});

describe('NotFoundPage (AC-13)', () => {
  it('renders no workspace name or id, even at a workspace address', () => {
    render(
      <MemoryRouter initialEntries={['/w/3f2b8c1e-0000-4000-8000-000000000000/inbox']}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/3f2b8c1e|Bolt Bikes/);
  });

  it('Go to my workspace runs the AC-07 resolution', async () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to my workspace' }));
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalledTimes(1));
  });
});

describe('route table', () => {
  it.each([
    ['/sign-in', 'Sign in'],
    ['/invite/abc', 'Accept invitation'],
    ['/reset-password/abc', 'Set a new password'],
    ['/workspaces', 'Your workspaces'],
    ['/no-access', 'You no longer have access to any workspace'],
    ['/w/w1', 'Workspace home'],
    ['/w/w1/team', 'Team'],
    ['/nope/never', 'Page not found'],
  ])('%s resolves', async (path, heading) => {
    useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });
});
