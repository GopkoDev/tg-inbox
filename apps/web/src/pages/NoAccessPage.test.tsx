import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';

const getMe = vi.fn();
const signOut = vi.fn();
vi.mock('@/features/auth/api', () => ({ getMe: () => getMe(), signOut: () => signOut() }));

import { NoAccessPage } from './NoAccessPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/no-access']}>
      <Routes>
        <Route path="/no-access" element={<NoAccessPage />} />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockReturnValue(new Promise(() => undefined));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
});

describe('NoAccessPage (AC-10)', () => {
  it('default: no-access text, signed-in email, no notice', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'You no longer have access to any workspace' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/o@x\.io/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('access-removed: names the workspace in a notice', () => {
    useWorkspaceStore
      .getState()
      .setAccessRemovedNotice({ workspaceId: 'w1', name: 'Acme Flowers' });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Your access to Acme Flowers was removed');
  });

  it('Sign out calls signOut and goes to sign-in', async () => {
    signOut.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText('sign-in screen')).toBeInTheDocument());
    expect(signOut).toHaveBeenCalled();
    expect(useAuthStore.getState().account).toBeNull();
  });
});
