import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { AppShell } from '@/shared/ui/app-shell';
import { openMenu, stubRadixDom } from '@/test/radix';
import { InDataRouter } from '@/test/router';

vi.mock('@/features/auth/api', () => ({ getMe: vi.fn(), signOut: vi.fn() }));
const listMyWorkspaces = vi.fn();
const listMemberships = vi.fn();
const listPendingInvitations = vi.fn();
vi.mock('@/features/workspaces/api', () => ({
  listMyWorkspaces: (a?: string) => listMyWorkspaces(a),
  enterWorkspace: vi.fn(),
  listMemberships: (w: string, a?: string) => listMemberships(w, a),
  listPendingInvitations: (w: string, a?: string) => listPendingInvitations(w, a),
  deactivateMembership: vi.fn(),
  reactivateMembership: vi.fn(),
  revokeInvitation: vi.fn(),
  createInvitation: vi.fn(),
}));
vi.mock('@/features/workspaces/resolve', () => ({ resolveWorkspace: vi.fn() }));

import { TeamPage } from '@/pages/TeamPage';

const acme = { id: 'w1', name: 'Acme Flowers', role: 'owner' as const };
const mem = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  display_name: name,
  email: `${name.toLowerCase()}@x.test`,
  role: 'operator' as const,
  state: 'active' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  deactivated_at: null,
  telegram_pings: false,
  ...over,
});
const page = <T,>(items: T[], has_next = false) => ({
  items,
  has_next,
  has_prev: false,
  next_cursor: has_next ? 'c1' : null,
});
const inv = (id: string, email: string, role: 'owner' | 'operator' = 'operator') => ({
  id,
  email,
  role,
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2026-02-01T00:00:00.000Z',
});

// 6 members: Olga (owner, you), Dina (owner), Bob/Anna/Eve (operator, active), Carl (operator, deactivated)
const olga = mem('m1', 'Olga', { role: 'owner', email: 'o@x.io' });
const dina = mem('m2', 'Dina', { role: 'owner' });
const bob = mem('m3', 'Bob');
const anna = mem('m4', 'Anna');
const eve = mem('m5', 'Eve');
const carl = mem('m6', 'Carl', {
  state: 'deactivated',
  deactivated_at: '2026-03-01T00:00:00.000Z',
});
const invNew = inv('i1', 'new@x.test');
const invChief = inv('i2', 'chief@y.test', 'owner');

function renderPage() {
  return render(
    <InDataRouter initialEntries={['/w/w1/team']}>
      <Routes>
        <Route path="/w/:workspaceId/team" element={<AppShell />}>
          <Route index element={<TeamPage />} />
        </Route>
        <Route path="/w/:workspaceId/inbox" element={<p>inbox screen</p>} />
        <Route path="*" element={<p>other</p>} />
      </Routes>
    </InDataRouter>,
  );
}
const rowOf = (text: string) => screen.getByText(text).closest('tr')!;
const search = () => screen.getByRole('textbox', { name: /Search by name or email/ });
const typeQuery = (value: string) => fireEvent.change(search(), { target: { value } });
/** Radix Select: open the trigger (named by its aria-label), pick the option. */
async function choose(trigger: RegExp, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: trigger }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const pending = () => screen.getByTestId('pending-invitations');

beforeEach(() => {
  stubRadixDom();
  vi.resetAllMocks();
  listMyWorkspaces.mockResolvedValue(page([acme]));
  listMemberships.mockResolvedValue(page([olga, dina, bob, anna, eve, carl]));
  listPendingInvitations.mockResolvedValue(page([invNew, invChief]));
  useAuthStore.getState().clear();
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'Olga' });
  useWorkspaceStore.getState().setCurrent(acme);
});

describe('Team filters (SCR-12, AC-08)', () => {
  it('search + role Operator + state Active narrow both tables; clearing restores every row', async () => {
    renderPage();
    await screen.findByText('Bob');
    typeQuery('x.test');
    await choose(/role/i, 'Operator');
    await choose(/state/i, 'Active');

    for (const name of ['Bob', 'Anna', 'Eve']) expect(screen.getByText(name)).toBeInTheDocument();
    for (const name of ['Olga', 'Dina', 'Carl'])
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    // invitations: search + role apply, state does not
    expect(within(pending()).getByText('new@x.test')).toBeInTheDocument();
    expect(within(pending()).queryByText('chief@y.test')).not.toBeInTheDocument();

    typeQuery('');
    await choose(/role/i, 'All roles');
    await choose(/state/i, 'All states');
    for (const name of ['Olga', 'Dina', 'Bob', 'Anna', 'Eve', 'Carl'])
      expect(screen.getByText(name)).toBeInTheDocument();
    expect(within(pending()).getByText('chief@y.test')).toBeInTheDocument();
  });

  it('the role filter offers «Business owner» and narrows to owners', async () => {
    renderPage();
    await screen.findByText('Bob');
    await choose(/role/i, 'Business owner');
    for (const name of ['Olga', 'Dina']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(within(pending()).getByText('chief@y.test')).toBeInTheDocument();
  });

  it('the search is case-insensitive over name and email', async () => {
    renderPage();
    await screen.findByText('Bob');
    typeQuery('ANNA@X');
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    typeQuery('dIn');
    expect(screen.getByText('Dina')).toBeInTheDocument();
    expect(screen.queryByText('Anna')).not.toBeInTheDocument();
  });

  it('the state filter leaves pending invitations untouched', async () => {
    renderPage();
    await screen.findByText('Bob');
    await choose(/state/i, 'Deactivated');
    expect(screen.getByText('Carl')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(within(pending()).getByText('new@x.test')).toBeInTheDocument();
    expect(within(pending()).getByText('chief@y.test')).toBeInTheDocument();
  });

  it('member rows: name, email, role badge, state badge, row-actions menu button', async () => {
    renderPage();
    await screen.findByText('Bob');
    const row = rowOf('Bob');
    expect(within(row).getByText('bob@x.test')).toBeInTheDocument();
    expect(within(row).getByText('Operator')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Actions for bob@x.test' })).toBeInTheDocument();
    expect(within(rowOf('Carl')).getByText('Deactivated')).toBeInTheDocument();
  });

  it('invitation rows: email, role, expiry, row-actions menu, never a link', async () => {
    renderPage();
    await screen.findByText('new@x.test');
    const row = within(pending()).getByText('new@x.test').closest('tr')!;
    expect(within(row).getAllByText('Operator').length).toBeGreaterThan(0);
    expect(within(row).getByText(/expires/i)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Actions for new@x.test' })).toBeInTheDocument();
    expect(within(pending()).queryByRole('link')).not.toBeInTheDocument();
  });

  it('row actions live in a menu: Deactivate for active, Reactivate for deactivated, Revoke for invitations', async () => {
    renderPage();
    await screen.findByText('Bob');
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).not.toBeInTheDocument();
    openMenu('Actions for bob@x.test');
    expect(await screen.findByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    openMenu('Actions for carl@x.test');
    expect(await screen.findByRole('menuitem', { name: 'Reactivate' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    openMenu('Actions for new@x.test');
    expect(await screen.findByRole('menuitem', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('Show more stays visible under an active filter; newly loaded rows are filtered the same way', async () => {
    listMemberships.mockResolvedValueOnce(page([olga, bob], true));
    listMemberships.mockResolvedValueOnce(page([dina, anna]));
    listPendingInvitations.mockResolvedValue(page([invNew]));
    renderPage();
    await screen.findByText('Bob');
    await choose(/role/i, 'Operator');
    expect(screen.queryByText('Olga')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(listMemberships).toHaveBeenLastCalledWith('w1', 'c1');
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Dina')).not.toBeInTheDocument();
    expect(screen.queryByText('Olga')).not.toBeInTheDocument();
  });
});

describe('Team filters: nothing matches (AC-09)', () => {
  it('each table shows the sentence + Clear filters; clearing restores the rows', async () => {
    renderPage();
    await screen.findByText('Bob');
    typeQuery('zzz-nobody');
    expect(screen.getAllByText('Nothing matches among the loaded rows')).toHaveLength(2);
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.queryByText('new@x.test')).not.toBeInTheDocument();
    const clears = screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clears).toHaveLength(2);
    fireEvent.click(clears[0]!);
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('new@x.test')).toBeInTheDocument();
    expect(search()).toHaveValue('');
    expect(screen.queryByText('Nothing matches among the loaded rows')).not.toBeInTheDocument();
  });

  it('Show more is still available under the empty sentence when more rows exist', async () => {
    listMemberships.mockResolvedValueOnce(page([olga, bob], true));
    renderPage();
    await screen.findByText('Bob');
    typeQuery('zzz-nobody');
    expect(screen.getAllByText('Nothing matches among the loaded rows').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });
});

describe('Team owners only (AC-10)', () => {
  it('refusal text + Back to inbox leading to the inbox; no list', async () => {
    const refusal = new ApiError(403, 'OWNER_ONLY' as never, 'OWNER_ONLY');
    listMemberships.mockRejectedValue(refusal);
    listPendingInvitations.mockRejectedValue(refusal);
    renderPage();
    expect(await screen.findByText('Only business owners manage the team')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /Search by name or email/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(await screen.findByText('inbox screen')).toBeInTheDocument();
  });
});
