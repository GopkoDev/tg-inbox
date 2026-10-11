import { ErrorCode, type InvitationPreview, type Me, type WorkspaceSummary } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

interface AcceptBody {
  token: string;
  password: string;
  display_name?: string;
}
const lookUpInvitation = vi.fn<(token: string) => Promise<InvitationPreview>>();
const acceptInvitation = vi.fn<(b: AcceptBody) => Promise<WorkspaceSummary>>();
const enterWorkspace = vi.fn<(id: string) => Promise<WorkspaceSummary>>();
const getMe = vi.fn<() => Promise<Me>>();
vi.mock('@/features/auth/api', () => ({
  lookUpInvitation: (t: string) => lookUpInvitation(t),
  acceptInvitation: (b: AcceptBody) => acceptInvitation(b),
  getMe: () => getMe(),
  signOut: vi.fn(),
}));

vi.mock('@/features/workspaces/api', () => ({
  enterWorkspace: (id: string) => enterWorkspace(id),
}));

import { AcceptInvitationPage } from './AcceptInvitationPage';

const WS: WorkspaceSummary = {
  id: '01920000-0000-7000-8000-0000000000b2',
  name: 'Acme',
  role: 'operator',
};
const preview = (account_exists: boolean): InvitationPreview => ({
  workspace_name: 'Acme',
  email: 'new@x.io',
  role: 'operator',
  account_exists,
});

const TOKEN = 'A'.repeat(43);

function renderPage(path: string = TOKEN) {
  return render(
    <MemoryRouter initialEntries={[`/invite/${path}`]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvitationPage />} />
        <Route path="/w/:id" element={<p>workspace home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const join = () => fireEvent.click(screen.getByRole('button', { name: /join/i }));

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockRejectedValue(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'Sign in required'));
  enterWorkspace.mockResolvedValue(WS);
});

describe('malformed invitation tokens (review #16)', () => {
  it.each([
    ['42 chars', 'A'.repeat(42)],
    ['bad paste with %', `${'A'.repeat(40)}%20x`],
  ])('AC-06 %s: SCR-03 without a lookup', async (_name, bad) => {
    renderPage(bad);
    expect(
      await screen.findByRole('heading', { name: "This link can't be used" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask a business owner for a new one/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(lookUpInvitation).not.toHaveBeenCalled();
  });

  it('AC-06 lookup 400 VALIDATION_ERROR maps to SCR-03, not Retry', async () => {
    lookUpInvitation.mockRejectedValue(new ApiError(400, ErrorCode.VALIDATION_ERROR, 'bad'));
    renderPage();
    expect(
      await screen.findByRole('heading', { name: "This link can't be used" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('SCR-02 copy: Join <workspace> heading, invited-as line and button names', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeInTheDocument();
    expect(screen.getByText('You are invited as')).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account and join' })).toBeInTheDocument();
  });

  it('SCR-02 copy: existing account keeps "Join workspace"', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Join workspace' })).toBeInTheDocument();
  });
});

describe('AcceptInvitationPage', () => {
  it('loading: shows a skeleton while the lookup is in flight', () => {
    lookUpInvitation.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('invitation-loading')).toBeInTheDocument();
    expect(lookUpInvitation).toHaveBeenCalledWith(TOKEN);
  });

  it('AC-03 default: new account shows workspace, read-only email, role, name and password', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('new@x.io');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
  });

  it('AC-04 default: existing account asks only for the existing password', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    renderPage();
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.getByText('new@x.io already has a tg-inbox account. Enter its password to join.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('AC-03 success: accepts with name and password and navigates; the shell enters', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockResolvedValue(WS);
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByText('workspace home')).toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledWith({
      token: TOKEN,
      password: 'longenough1',
      display_name: 'Nina',
    });
    expect(enterWorkspace).not.toHaveBeenCalled();
  });

  it('AC-04 success: existing account sends no display_name', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    acceptInvitation.mockResolvedValue(WS);
    renderPage();
    await screen.findByLabelText('Password');
    change('Password', 'existing-pass');
    join();
    await screen.findByText('workspace home');
    expect(acceptInvitation).toHaveBeenCalledWith({ token: TOKEN, password: 'existing-pass' });
  });

  it('submitting: disables the form while acceptInvitation is in flight', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', 'longenough1');
    join();
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeDisabled());
    expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
  });

  it('AC-05 validation: a 9-character password is blocked client-side', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', '123456789');
    join();
    expect(
      await screen.findByText('The password must be at least 10 characters long', {
        selector: 'p#password-error',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('validation: blank name is blocked client-side', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    await screen.findByLabelText('Your name');
    change('Password', 'longenough1');
    join();
    await waitFor(() =>
      expect(screen.getByLabelText('Your name')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('validation: server 400 shows the message under details.field', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockRejectedValue(
      new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Name is too long', { field: 'display_name' }),
    );
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByText('Name is too long')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('invalid credentials: alert, password cleared', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    acceptInvitation.mockRejectedValue(
      new ApiError(401, ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect'),
    );
    renderPage();
    await screen.findByLabelText('Password');
    change('Password', 'wrong-password');
    join();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('AC-06 link unavailable on lookup: renders SCR-03 in place', async () => {
    lookUpInvitation.mockRejectedValue(
      new ApiError(404, ErrorCode.INVITATION_INVALID, 'invalid', { ask: 'business_owner' }),
    );
    renderPage();
    expect(await screen.findByText(/ask a business owner for a new one/i)).toBeInTheDocument();
  });

  it('AC-06 revoked between lookup and submit: SCR-03 in place', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockRejectedValue(
      new ApiError(404, ErrorCode.INVITATION_INVALID, 'invalid', { ask: 'tg_inbox_team' }),
    );
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByText(/ask the tg-inbox team for a new one/i)).toBeInTheDocument();
  });

  it('AC-04b another email: SCR-03 in place', async () => {
    lookUpInvitation.mockRejectedValue(
      new ApiError(403, ErrorCode.INVITATION_FOR_ANOTHER_EMAIL, 'other'),
    );
    renderPage();
    expect(await screen.findByText(/belongs to another email/i)).toBeInTheDocument();
  });

  it('unexpected on lookup: generic alert and Retry reloads the lookup', async () => {
    lookUpInvitation.mockRejectedValueOnce(new TypeError('network'));
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
  });

  it('unexpected on submit: alert, form stays filled', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockRejectedValue(new TypeError('network'));
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Your name')).toHaveValue('Nina');
    expect(screen.getByLabelText('Password')).toHaveValue('longenough1');
  });
});

describe('client rules come from the shared schemas (fix 2026-10-11-shared-form-validation)', () => {
  it('AC-05b: a password over 1024 characters is blocked client-side with the server message', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', 'Nina');
    change('Password', 'x'.repeat(1025));
    join();
    expect(
      await screen.findByText('The password must be at most 1024 characters long', {
        selector: 'p#password-error',
      }),
    ).toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ['blank', ''],
    ['whitespace-only', '   '],
    ['over 200 characters', 'n'.repeat(201)],
  ])('AC-05b: a %s name is blocked client-side with the server message', async (_case, value) => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    await screen.findByLabelText('Your name');
    change('Your name', value);
    change('Password', 'longenough1');
    join();
    expect(
      await screen.findByText('Enter your name (up to 200 characters)', {
        selector: 'p#name-error',
      }),
    ).toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('AC-04: an existing account is not held to the new-password minimum', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    acceptInvitation.mockResolvedValue(WS);
    renderPage();
    await screen.findByLabelText('Password');
    change('Password', 'short-pw');
    join();
    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith({ token: TOKEN, password: 'short-pw' }),
    );
  });

  it('AC-05b: an existing account password over 1024 characters is blocked client-side', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    renderPage();
    await screen.findByLabelText('Password');
    change('Password', 'x'.repeat(1025));
    join();
    expect(
      await screen.findByText('The password must be at most 1024 characters long', {
        selector: 'p#password-error',
      }),
    ).toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });
});
