import { ErrorCode, type Me } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const getMe = vi.fn<() => Promise<Me>>();
const signIn = vi.fn<(b: { email: string; password: string }) => Promise<undefined>>();
const resolveWorkspace = vi.fn();
vi.mock('@/features/auth/api', () => ({
  getMe: () => getMe(),
  signIn: (b: { email: string; password: string }) => signIn(b),
}));
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));

import { SignInPage } from './SignInPage';

const unauth = () => new ApiError(401, ErrorCode.UNAUTHENTICATED, 'Sign in required');

function renderPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/sign-in', state }]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(email = 'o@x.io', password = 'secret-pass') {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockRejectedValue(unauth());
  resolveWorkspace.mockResolvedValue(undefined);
});

describe('SignInPage', () => {
  it('loading: shows a skeleton while getMe is in flight', () => {
    getMe.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('sign-in-loading')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('default: shows the form and the static forgot-password help', async () => {
    renderPage();
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText(/forgot your password/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('existing session: resolves the workspace instead of showing the form', async () => {
    const me: Me = {
      account: { id: 'a', email: 'o@x.io', display_name: 'O' },
      last_used_workspace_id: null,
    };
    getMe.mockResolvedValue(me);
    renderPage();
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalledWith(expect.any(Function), me));
  });

  it('submitting: disables fields and button while signIn is in flight', async () => {
    signIn.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await fill();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('validation: shows the server message under the email field', async () => {
    signIn.mockRejectedValue(
      new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Enter a valid email address'),
    );
    renderPage();
    await fill('not-an-email');
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('invalid credentials: shows the server message and clears the password', async () => {
    signIn.mockRejectedValue(
      new ApiError(401, ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect'),
    );
    renderPage();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('o@x.io');
  });

  it('locked out: shows the too-many-attempts message', async () => {
    signIn.mockRejectedValue(
      new ApiError(429, ErrorCode.TOO_MANY_ATTEMPTS, 'Too many failed attempts, try again later'),
    );
    renderPage();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many failed attempts, try again later',
    );
  });

  it('server failure: generic alert, form kept', async () => {
    signIn.mockRejectedValue(new TypeError('network'));
    renderPage();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Email')).toHaveValue('o@x.io');
  });

  it('session-ended: shows the neutral notice', async () => {
    renderPage({ reason: 'session-ended' });
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
  });

  it('success: signs in with the typed credentials and runs the AC-07 resolution', async () => {
    signIn.mockResolvedValue(undefined);
    renderPage();
    await fill();
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith({ email: 'o@x.io', password: 'secret-pass' });
  });
});
