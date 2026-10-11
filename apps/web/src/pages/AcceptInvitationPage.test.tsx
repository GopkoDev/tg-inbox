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
  enterWorkspace: (id: string) => enterWorkspace(id),
  getMe: () => getMe(),
  signOut: vi.fn(),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/invite/tok123']}>
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

describe('AcceptInvitationPage', () => {
  it('loading: shows a skeleton while the lookup is in flight', () => {
    lookUpInvitation.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByTestId('invitation-loading')).toBeInTheDocument();
    expect(lookUpInvitation).toHaveBeenCalledWith('tok123');
  });

  it('AC-03 default: new account shows workspace, read-only email, role, name and password', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('new@x.io');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
  });

  it('AC-04 default: existing account asks only for the existing password', async () => {
    lookUpInvitation.mockResolvedValue(preview(true));
    renderPage();
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('AC-03 success: accepts with name and password, enters the workspace and navigates', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockResolvedValue(WS);
    renderPage();
    await screen.findByLabelText('Name');
    change('Name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByText('workspace home')).toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledWith({
      token: 'tok123',
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
    expect(acceptInvitation).toHaveBeenCalledWith({ token: 'tok123', password: 'existing-pass' });
  });

  it('submitting: disables the form while acceptInvitation is in flight', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByLabelText('Name');
    change('Name', 'Nina');
    change('Password', 'longenough1');
    join();
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeDisabled());
    expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
  });

  it('AC-05 validation: a 9-character password is blocked client-side', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    renderPage();
    await screen.findByLabelText('Name');
    change('Name', 'Nina');
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
    await screen.findByLabelText('Name');
    change('Password', 'longenough1');
    join();
    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('validation: server 400 shows the message under details.field', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockRejectedValue(
      new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Name is too long', { field: 'display_name' }),
    );
    renderPage();
    await screen.findByLabelText('Name');
    change('Name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByText('Name is too long')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
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
    await screen.findByLabelText('Name');
    change('Name', 'Nina');
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
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
  });

  it('unexpected on submit: alert, form stays filled', async () => {
    lookUpInvitation.mockResolvedValue(preview(false));
    acceptInvitation.mockRejectedValue(new TypeError('network'));
    renderPage();
    await screen.findByLabelText('Name');
    change('Name', 'Nina');
    change('Password', 'longenough1');
    join();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Name')).toHaveValue('Nina');
    expect(screen.getByLabelText('Password')).toHaveValue('longenough1');
  });
});
