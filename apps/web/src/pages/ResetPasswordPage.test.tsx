import { ErrorCode } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const lookUpPasswordResetLink = vi.fn<(token: string) => Promise<undefined>>();
const redeemPasswordResetLink =
  vi.fn<(b: { token: string; password: string }) => Promise<undefined>>();
const getMe = vi.fn();
const resolveWorkspace = vi.fn();
vi.mock('@/features/auth/api', () => ({
  lookUpPasswordResetLink: (t: string) => lookUpPasswordResetLink(t),
  redeemPasswordResetLink: (b: { token: string; password: string }) => redeemPasswordResetLink(b),
  getMe: () => getMe(),
  signOut: vi.fn(),
}));
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));

import { ResetPasswordPage } from './ResetPasswordPage';

const invalid = () => new ApiError(404, ErrorCode.RESET_LINK_INVALID, 'invalid');

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reset-password/tok123']}>
      <Routes>
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const typePassword = (value: string) =>
  fireEvent.change(screen.getByLabelText('New password'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: /set password/i }));

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockRejectedValue(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'Sign in required'));
  resolveWorkspace.mockResolvedValue(undefined);
  lookUpPasswordResetLink.mockResolvedValue(undefined);
});

describe('ResetPasswordPage', () => {
  it('loading: skeleton while the lookup is in flight', () => {
    lookUpPasswordResetLink.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('reset-loading')).toBeInTheDocument();
    expect(lookUpPasswordResetLink).toHaveBeenCalledWith('tok123');
  });

  it('default: password field with hint and footer', async () => {
    renderPage();
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByText('Every other device will be signed out.')).toBeInTheDocument();
  });

  it('validation: short password blocked client-side', async () => {
    renderPage();
    await screen.findByLabelText('New password');
    typePassword('x'.repeat(9));
    submit();
    expect(
      await screen.findByText('The password must be at least 10 characters long'),
    ).toBeInTheDocument();
    expect(redeemPasswordResetLink).not.toHaveBeenCalled();
  });

  it('validation: server 400 shows under the field', async () => {
    redeemPasswordResetLink.mockRejectedValue(
      new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Server says no', { field: 'password' }),
    );
    renderPage();
    await screen.findByLabelText('New password');
    typePassword('x'.repeat(10));
    submit();
    expect(await screen.findByText('Server says no')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('AC-22: lookup 404 renders the reset-link-invalid screen', async () => {
    lookUpPasswordResetLink.mockRejectedValue(invalid());
    renderPage();
    expect(
      await screen.findByText(
        /reset link is no longer valid.*ask the tg-inbox team for a new one/i,
      ),
    ).toBeInTheDocument();
  });

  it('AC-22: submit 404 renders the reset-link-invalid screen in place', async () => {
    redeemPasswordResetLink.mockRejectedValue(invalid());
    renderPage();
    await screen.findByLabelText('New password');
    typePassword('x'.repeat(10));
    submit();
    expect(await screen.findByText(/reset link is no longer valid/i)).toBeInTheDocument();
  });

  it('unexpected: lookup failure shows alert and Retry', async () => {
    lookUpPasswordResetLink.mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
  });

  it('unexpected: submit failure keeps the form', async () => {
    redeemPasswordResetLink.mockRejectedValue(new Error('network'));
    renderPage();
    await screen.findByLabelText('New password');
    typePassword('x'.repeat(10));
    submit();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('x'.repeat(10));
  });

  it('submitting: form disabled while in flight', async () => {
    redeemPasswordResetLink.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByLabelText('New password');
    typePassword('x'.repeat(10));
    submit();
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeDisabled());
    expect(screen.getByRole('button', { name: /set password/i })).toBeDisabled();
  });

  it('AC-21 success: redeems then runs the AC-07 resolution', async () => {
    redeemPasswordResetLink.mockResolvedValue(undefined);
    renderPage();
    await screen.findByLabelText('New password');
    typePassword('correct horse battery');
    submit();
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalled());
    expect(redeemPasswordResetLink).toHaveBeenCalledWith({
      token: 'tok123',
      password: 'correct horse battery',
    });
  });
});
