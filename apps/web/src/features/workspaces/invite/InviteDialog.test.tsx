import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

const createInvitation = vi.fn();
vi.mock('../api', () => ({
  createInvitation: (w: string, b: unknown) => createInvitation(w, b),
}));
const guard = vi.fn();
vi.mock('@/shared/ui/app-shell-context', () => ({ useShellGuard: () => guard }));

import { InviteDialog } from './InviteDialog';

const issued = {
  invitation: {
    id: 'i1',
    email: 'max@acme.test',
    role: 'operator' as const,
    created_at: '2026-10-11T12:00:00.000Z',
    expires_at: '2026-10-18T12:00:00.000Z',
  },
  link: 'https://app.test/invite/secret-token',
};
const err = (status: number, code: string, message = code) =>
  new ApiError(status, code as never, message);

const onClose = vi.fn();
const onFail = vi.fn();
function setup(open = true) {
  const ui = (o: boolean) => (
    <InviteDialog workspaceId="w1" open={o} onClose={onClose} onFail={onFail} />
  );
  const view = render(ui(open));
  return { ...view, setOpen: (o: boolean) => view.rerender(ui(o)) };
}
const typeEmail = (value: string) =>
  fireEvent.change(screen.getByLabelText('Email'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Create invitation/ }));

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  guard.mockRejectedValue(new Error('unhandled'));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
});

describe('InviteDialog (SCR-08)', () => {
  it('email error is the input accessible description; Role group has a visible label', async () => {
    createInvitation.mockRejectedValue(err(400, 'VALIDATION_ERROR', 'Enter a valid email'));
    setup();
    typeEmail('max@acme.test');
    submit();
    await screen.findByText('Enter a valid email');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter a valid email');
    expect(screen.getByRole('radiogroup', { name: 'Role' })).toBeInTheDocument();
    expect(screen.getByText('Role', { selector: 'label' })).toBeInTheDocument();
  });

  it('default: email field, Operator preselected, Create invitation', () => {
    setup();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Operator' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Business owner' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Create invitation/ })).toBeInTheDocument();
  });

  it('submitting: form disabled while in flight', async () => {
    createInvitation.mockReturnValue(new Promise(() => undefined));
    setup();
    typeEmail('max@acme.test');
    submit();
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeDisabled());
    expect(screen.getByRole('button', { name: /Create invitation/ })).toBeDisabled();
    expect(createInvitation).toHaveBeenCalledWith('w1', {
      email: 'max@acme.test',
      role: 'operator',
    });
  });

  it('sends the chosen role', async () => {
    createInvitation.mockReturnValue(new Promise(() => undefined));
    setup();
    typeEmail(' Max@Acme.test ');
    fireEvent.click(screen.getByRole('radio', { name: 'Business owner' }));
    submit();
    await waitFor(() => expect(createInvitation).toHaveBeenCalled());
    expect(createInvitation).toHaveBeenCalledWith('w1', {
      email: 'Max@Acme.test',
      role: 'owner',
    });
  });

  it('validation: 400 message under the email field, form kept (AC-14)', async () => {
    createInvitation.mockRejectedValue(err(400, 'VALIDATION_ERROR', 'Enter a valid email address'));
    setup();
    typeEmail('max@acme.test');
    submit();
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toBeEnabled();
  });

  it('already a member: destructive alert, form kept (AC-16)', async () => {
    createInvitation.mockRejectedValue(err(409, 'ALREADY_A_MEMBER'));
    setup();
    typeEmail('bob@x.test');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This person is already a member — reactivate them instead if they are deactivated',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('bob@x.test');
  });

  it('success: summary, link once, replaced note, warning, Copy (AC-14)', async () => {
    createInvitation.mockResolvedValue(issued);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    typeEmail('Max@Acme.test');
    submit();
    expect(
      await screen.findByText(/Invitation created for max@acme.test \(Operator\), valid until/),
    ).toHaveTextContent('18 Oct 2026');
    expect(screen.getByText(/earlier pending invitation/i)).toBeInTheDocument();
    const field = screen.getByDisplayValue(issued.link);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByText("You won't see this link again — copy it now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(issued.link));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('Copied label turns back after 2 s', async () => {
    createInvitation.mockResolvedValue(issued);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    setup();
    typeEmail('max@acme.test');
    submit();
    await screen.findByDisplayValue(issued.link);
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(2100));
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closed: Done reports a created invitation; reopening shows no link (AC-14 once)', async () => {
    createInvitation.mockResolvedValue(issued);
    const { setOpen } = setup();
    typeEmail('max@acme.test');
    submit();
    await screen.findByDisplayValue(issued.link);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledWith(true);
    setOpen(false);
    setOpen(true);
    expect(screen.queryByDisplayValue(issued.link)).not.toBeInTheDocument();
    expect(screen.queryByText(issued.link)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('closed without creating reports false', () => {
    setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('the link is never written to a store (AC-14 once)', async () => {
    createInvitation.mockResolvedValue(issued);
    setup();
    typeEmail('max@acme.test');
    submit();
    await screen.findByDisplayValue(issued.link);
    expect(JSON.stringify(useWorkspaceStore.getState())).not.toContain('secret-token');
    expect(JSON.stringify(useAuthStore.getState())).not.toContain('secret-token');
  });

  it('403 OWNER_ONLY: notifies the screen (AC-15)', async () => {
    createInvitation.mockRejectedValue(err(403, 'OWNER_ONLY'));
    setup();
    typeEmail('max@acme.test');
    submit();
    await waitFor(() => expect(onFail).toHaveBeenCalledWith('owner-only'));
  });

  it('guard answers go to the shared guard; 404 is reported', async () => {
    const e = err(404, 'NOT_FOUND');
    createInvitation.mockRejectedValue(e);
    guard.mockResolvedValue('not-found');
    setup();
    typeEmail('max@acme.test');
    submit();
    await waitFor(() => expect(onFail).toHaveBeenCalledWith('not-found'));
    expect(guard).toHaveBeenCalledWith(e, 'w1');
  });

  it('unexpected: alert in the dialog, form kept', async () => {
    createInvitation.mockRejectedValue(new Error('net'));
    setup();
    typeEmail('max@acme.test');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Email')).toBeEnabled();
  });
});

describe('client rules come from the shared schemas (fix 2026-10-11-shared-form-validation)', () => {
  it('an invalid email is blocked client-side with the server message', async () => {
    setup();
    typeEmail('nope');
    submit();
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(createInvitation).not.toHaveBeenCalled();
  });
});
