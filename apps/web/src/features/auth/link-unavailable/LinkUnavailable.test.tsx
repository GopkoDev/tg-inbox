import { ErrorCode, type Me } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const getMe = vi.fn<() => Promise<Me>>();
const signOut = vi.fn<() => Promise<undefined>>();
const resolveWorkspace = vi.fn();
vi.mock('@/features/auth/api', () => ({
  getMe: () => getMe(),
  signOut: () => signOut(),
}));
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));

import { LinkUnavailable } from './LinkUnavailable';

const me: Me = {
  account: { id: 'a', email: 'o@x.io', display_name: 'O' },
  last_used_workspace_id: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockRejectedValue(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'Sign in required'));
  resolveWorkspace.mockResolvedValue(undefined);
});

const renderIt = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('LinkUnavailable', () => {
  it('AC-06: ask a business owner', async () => {
    const { container } = renderIt(
      <LinkUnavailable reason="invitation-invalid" ask="business_owner" />,
    );
    expect(
      await screen.findByText(/no longer valid.*ask a business owner for a new one/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: "This link can't be used" }),
    ).toBeVisible();
    expect(container.querySelector('svg.lucide-messages-square')).not.toBeNull();
  });

  it('AC-06: ask the tg-inbox team', async () => {
    renderIt(<LinkUnavailable reason="invitation-invalid" ask="tg_inbox_team" />);
    expect(await screen.findByText(/ask the tg-inbox team for a new one/i)).toBeInTheDocument();
  });

  it('no session: offers Go to sign-in', async () => {
    renderIt(<LinkUnavailable reason="invitation-invalid" ask="business_owner" />);
    expect(await screen.findByRole('link', { name: /go to sign-in/i })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('with a session: Go to my workspace runs the AC-07 resolution', async () => {
    getMe.mockResolvedValue(me);
    renderIt(<LinkUnavailable reason="invitation-invalid" ask="business_owner" />);
    fireEvent.click(await screen.findByRole('button', { name: /go to my workspace/i }));
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalled());
  });

  it('AC-04b: another email shows Sign out, which signs out and reloads the link', async () => {
    getMe.mockResolvedValue(me);
    signOut.mockResolvedValue(undefined);
    const reload = vi.fn();
    renderIt(<LinkUnavailable reason="invitation-for-another-email" reload={reload} />);
    expect(
      await screen.findByRole('heading', { name: 'This invitation is for another email' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/belongs to another email/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(signOut).toHaveBeenCalled();
  });
});

describe('LinkUnavailable reset-link-invalid', () => {
  it('AC-22: explains the reset link is no longer valid', async () => {
    renderIt(<LinkUnavailable reason="reset-link-invalid" />);
    expect(
      await screen.findByText(
        /reset link is no longer valid.*ask the tg-inbox team for a new one/i,
      ),
    ).toBeInTheDocument();
  });
});
