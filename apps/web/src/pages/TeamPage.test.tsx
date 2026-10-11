import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { stubRadixDom } from '@/test/radix';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const listMemberships = vi.fn();
const listPendingInvitations = vi.fn();
const deactivateMembership = vi.fn();
const reactivateMembership = vi.fn();
const revokeInvitation = vi.fn();
const createInvitation = vi.fn();
const enterWorkspace = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (a?: string) => listMyWorkspaces(a),
  enterWorkspace: (id: string) => enterWorkspace(id),
  listMemberships: (w: string, a?: string) => listMemberships(w, a),
  listPendingInvitations: (w: string, a?: string) => listPendingInvitations(w, a),
  deactivateMembership: (w: string, id: string) => deactivateMembership(w, id),
  reactivateMembership: (w: string, id: string) => reactivateMembership(w, id),
  revokeInvitation: (w: string, id: string) => revokeInvitation(w, id),
  createInvitation: (w: string, b: unknown) => createInvitation(w, b),
}));
const resolveWorkspace = vi.fn();
vi.mock('@/features/workspaces/resolve', () => ({
  resolveWorkspace: (...a: unknown[]) => resolveWorkspace(...a),
}));

import { TeamPage } from './TeamPage';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const mem = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  display_name: name,
  email: `${name.toLowerCase()}@x.test`,
  role: 'operator' as const,
  state: 'active' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  deactivated_at: null,
  ...over,
});
const page = <T,>(items: T[], has_next = false) => ({
  items,
  has_next,
  has_prev: false,
  next_cursor: has_next ? 'c1' : null,
});
const inv = (id: string, email: string) => ({
  id,
  email,
  role: 'operator' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2026-02-01T00:00:00.000Z',
});
const owner = mem('m1', 'Olga', { role: 'owner', email: 'o@x.io' });
const bob = mem('m2', 'Bob');

function renderPage(path = '/w/w1/team') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId/team" element={<TeamPage />} />
        <Route path="/w/:workspaceId" element={<p>home screen</p>} />
        <Route path="/sign-in" element={<p>sign-in screen</p>} />
        <Route path="*" element={<p>other</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
function Jump({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(to)}>jump</button>;
}
const err = (status: number, code: string) => new ApiError(status, code as never, code);
const rowOf = (name: string) => screen.getByText(name).closest('tr')!;
const lastButton = async (name: string) => (await screen.findAllByRole('button', { name })).at(-1)!;

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue(page([acme]));
  listMemberships.mockResolvedValue(page([owner, bob]));
  listPendingInvitations.mockResolvedValue(page([inv('i1', 'new@x.test')]));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'Olga' });
  useWorkspaceStore.getState().setCurrent(acme);
});

describe('TeamPage (SCR-07)', () => {
  it('loading: skeleton rows while lists are in flight', () => {
    listMemberships.mockReturnValue(new Promise(() => undefined));
    listPendingInvitations.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getAllByTestId('team-skeleton').length).toBeGreaterThan(0);
  });

  it('default: members and pending invitations, no link ever (AC-20)', async () => {
    renderPage();
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('bob@x.test')).toBeInTheDocument();
    expect(screen.getByText('Olga')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    const pending = screen.getByTestId('pending-invitations');
    expect(within(pending).getByText('new@x.test')).toBeInTheDocument();
    expect(within(pending).getAllByText('operator').length).toBeGreaterThan(0);
    expect(within(pending).getByText(/expires/i)).toBeInTheDocument();
    expect(within(pending).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
    expect(listMemberships).toHaveBeenCalledWith('w1', undefined);
  });

  it('empty: no pending invitations line', async () => {
    listPendingInvitations.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText('No pending invitations')).toBeInTheDocument();
  });

  it('revoke: confirm, row removed (AC-20)', async () => {
    revokeInvitation.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('new@x.test');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(
      await screen.findByText('Revoke the invitation for new@x.test? Its link stops working.'),
    ).toBeInTheDocument();
    fireEvent.click(await lastButton('Revoke'));
    await waitFor(() => expect(screen.queryByText('new@x.test')).not.toBeInTheDocument());
    expect(revokeInvitation).toHaveBeenCalledWith('w1', 'i1');
    expect(screen.getByText('No pending invitations')).toBeInTheDocument();
  });

  it('deactivate: confirm text, then Deactivated badge and Reactivate action', async () => {
    deactivateMembership.mockResolvedValue({
      ...bob,
      state: 'deactivated',
      deactivated_at: '2026-03-01T00:00:00.000Z',
    });
    renderPage();
    await screen.findByText('Bob');
    fireEvent.click(within(rowOf('Bob')).getByRole('button', { name: 'Deactivate' }));
    expect(
      await screen.findByText(
        'Deactivate Bob? Bob loses access to Acme Flowers at once. You can reactivate them later.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(await lastButton('Deactivate'));
    await waitFor(() =>
      expect(within(rowOf('Bob')).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument(),
    );
    expect(within(rowOf('Bob')).getByText('Deactivated')).toBeInTheDocument();
  });

  it('reactivate: Active again with the same role (AC-19)', async () => {
    const dead = mem('m3', 'Carl', {
      state: 'deactivated',
      deactivated_at: '2026-03-01T00:00:00.000Z',
    });
    listMemberships.mockResolvedValue(page([owner, dead]));
    reactivateMembership.mockResolvedValue({ ...dead, state: 'active', deactivated_at: null });
    renderPage();
    await screen.findByText('Carl');
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(within(rowOf('Carl')).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument(),
    );
    expect(within(rowOf('Carl')).getByText('Active')).toBeInTheDocument();
    expect(within(rowOf('Carl')).getByText('operator')).toBeInTheDocument();
    expect(reactivateMembership).toHaveBeenCalledWith('w1', 'm3');
  });

  it('pending action: other row actions disabled while one is in flight', async () => {
    deactivateMembership.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('Bob');
    fireEvent.click(within(rowOf('Bob')).getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(await lastButton('Deactivate'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled());
  });

  it('409 LAST_ACTIVE_OWNER: alert, row unchanged (AC-18)', async () => {
    deactivateMembership.mockRejectedValue(err(409, 'LAST_ACTIVE_OWNER'));
    renderPage();
    await screen.findByText('Olga');
    fireEvent.click(within(rowOf('Olga')).getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(await lastButton('Deactivate'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A workspace must always have at least one active business owner',
    );
    expect(within(rowOf('Olga')).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('404 on action: stale alert and both lists reload', async () => {
    revokeInvitation.mockRejectedValue(err(404, 'NOT_FOUND'));
    renderPage();
    await screen.findByText('new@x.test');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(await lastButton('Revoke'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This item has changed — the list was refreshed',
    );
    await waitFor(() => expect(listMemberships).toHaveBeenCalledTimes(2));
    expect(listPendingInvitations).toHaveBeenCalledTimes(2);
  });

  it('403 OWNER_ONLY: only the owners-only body, no list (AC-15)', async () => {
    listMemberships.mockRejectedValue(err(403, 'OWNER_ONLY'));
    listPendingInvitations.mockRejectedValue(err(403, 'OWNER_ONLY'));
    renderPage();
    expect(await screen.findByText('Only business owners manage the team')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByText('home screen')).toBeInTheDocument();
  });

  it('403 ACCESS_REMOVED: shared guard handler (AC-17)', async () => {
    listMemberships.mockRejectedValue(err(403, 'ACCESS_REMOVED'));
    listPendingInvitations.mockRejectedValue(err(403, 'ACCESS_REMOVED'));
    resolveWorkspace.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().accessRemovedNotice).toBe('Acme Flowers');
  });

  it('401: guard goes to sign-in', async () => {
    listMemberships.mockRejectedValue(err(401, 'UNAUTHENTICATED'));
    listPendingInvitations.mockRejectedValue(err(401, 'UNAUTHENTICATED'));
    renderPage();
    expect(await screen.findByText('sign-in screen')).toBeInTheDocument();
  });

  it('has-more: Show more appends the next page', async () => {
    listMemberships.mockResolvedValueOnce(page([owner], true));
    listMemberships.mockResolvedValueOnce(page([bob]));
    renderPage();
    await screen.findByText('Olga');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(listMemberships).toHaveBeenLastCalledWith('w1', 'c1');
    expect(screen.getByText('Olga')).toBeInTheDocument();
  });

  it('has-more: a double click on Show more fires one request and appends once', async () => {
    listMemberships.mockResolvedValueOnce(page([owner], true));
    let resolveNext: (v: unknown) => void = () => undefined;
    listMemberships.mockReturnValueOnce(new Promise((r) => (resolveNext = r)));
    renderPage();
    await screen.findByText('Olga');
    const button = screen.getByRole('button', { name: 'Show more' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(listMemberships).toHaveBeenCalledTimes(2); // initial load + one page
    resolveNext(page([bob]));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getAllByText('Bob')).toHaveLength(1);
  });

  it('not-found in place: one main and one h1 inside the shell (AC-13)', async () => {
    listMemberships.mockRejectedValue(err(404, 'NOT_FOUND'));
    listPendingInvitations.mockRejectedValue(err(404, 'NOT_FOUND'));
    renderPage();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('error: unexpected list failure shows Something went wrong and Retry', async () => {
    listMemberships.mockRejectedValueOnce(new Error('net'));
    renderPage();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  it('error: unexpected action failure keeps the row', async () => {
    deactivateMembership.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByText('Bob');
    fireEvent.click(within(rowOf('Bob')).getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(await lastButton('Deactivate'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(within(rowOf('Bob')).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });
});

describe('TeamPage enters its workspace from the URL (AC-12, AC-13, AC-17)', () => {
  const bolt = { id: 'w2', name: 'Bolt Bikes', role: 'owner' as const };

  it('direct load with an empty store: enters and shows the name in the header', async () => {
    useWorkspaceStore.getState().clear();
    enterWorkspace.mockResolvedValue(acme);
    renderPage();
    expect(await screen.findByRole('button', { name: /Acme Flowers/ })).toBeInTheDocument();
    expect(enterWorkspace).toHaveBeenCalledWith('w1');
    expect(useWorkspaceStore.getState().current).toEqual(acme);
  });

  it('address change A -> B: the header never shows A, then shows B', async () => {
    enterWorkspace.mockResolvedValue(bolt);
    render(
      <MemoryRouter initialEntries={['/w/w1/team']}>
        <Routes>
          <Route path="/w/:workspaceId/team" element={<TeamPage />} />
        </Routes>
        <Jump to="/w/w2/team" />
      </MemoryRouter>,
    );
    await screen.findByText('Bob');
    expect(screen.getByRole('button', { name: /Acme Flowers/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'jump' }));
    expect(screen.queryByText('Acme Flowers')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Bolt Bikes/ })).toBeInTheDocument();
  });

  it('direct load for a workspace that does not exist: not-found, no name shown (AC-13)', async () => {
    useWorkspaceStore.getState().clear();
    enterWorkspace.mockRejectedValue(err(404, 'NOT_FOUND'));
    renderPage();
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByText('Acme Flowers')).not.toBeInTheDocument();
  });
});

describe('TeamPage invite dialog (SCR-08)', () => {
  const issued = {
    invitation: { ...inv('i2', 'max@acme.test') },
    link: 'https://app.test/invite/tok',
  };
  const openAndCreate = async () => {
    await screen.findByText('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'max@acme.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/ }));
  };

  it('Done refetches the pending list, shows the new row, link is gone', async () => {
    createInvitation.mockResolvedValue(issued);
    renderPage();
    await openAndCreate();
    await screen.findByDisplayValue(issued.link);
    listPendingInvitations.mockResolvedValue(
      page([inv('i1', 'new@x.test'), inv('i2', 'max@acme.test')]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      await within(screen.getByTestId('pending-invitations')).findByText('max@acme.test'),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(issued.link)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByLabelText('Email')).toHaveValue('');
    expect(screen.queryByDisplayValue(issued.link)).not.toBeInTheDocument();
  });

  it('403 OWNER_ONLY: dialog closes and the owners-only state shows (AC-15)', async () => {
    createInvitation.mockRejectedValue(err(403, 'OWNER_ONLY'));
    renderPage();
    await openAndCreate();
    expect(await screen.findByText('Only business owners manage the team')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
