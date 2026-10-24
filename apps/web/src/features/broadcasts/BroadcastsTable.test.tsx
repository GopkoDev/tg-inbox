import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BroadcastDraft, BroadcastList, BroadcastListItem, LiveFrame } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { openMenu, stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  listBroadcasts: vi.fn(),
  duplicateBroadcast: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listBroadcasts: (...a: unknown[]) => api.listBroadcasts(...a),
  duplicateBroadcast: (...a: unknown[]) => api.duplicateBroadcast(...a),
}));
const live = vi.hoisted(() => ({ onFrame: null as ((f: LiveFrame) => void) | null }));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (_ws: string, handlers: { onFrame: (f: LiveFrame) => void }) => {
    live.onFrame = handlers.onFrame;
    return () => {
      live.onFrame = null;
    };
  },
  liveStatus: () => 'idle',
}));

import { useBroadcastListStore } from './list-store';
import { BroadcastsTable } from './BroadcastsTable';
import { BroadcastsPage } from '@/pages/BroadcastsPage';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ME = id(11);
const TEAMMATE = id(12);
const NOW = new Date('2026-10-23T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });

const item = (n: number, over: Partial<BroadcastListItem> = {}): BroadcastListItem => ({
  id: id(500 + n),
  name: `Broadcast ${n}`,
  status: 'draft',
  audience_kind: 'tags',
  audience_size: 38,
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
  last_changed_at: ago(3 * 60_000),
  launched_at: null,
  ended_at: null,
  ...over,
});
const list = (items: BroadcastListItem[]): BroadcastList => ({ workspace_id: WS, items });

const guard = vi.fn();
const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
};
const where = () => screen.getByTestId('where').textContent;

function renderPage(role: 'owner' | 'operator' = 'operator') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/broadcasts`]}>
        <Where />
        <Routes>
          <Route path="/w/:workspaceId/broadcasts" element={<BroadcastsPage />} />
          <Route path="/w/:workspaceId/broadcasts/new" element={<p>new editor</p>} />
          <Route path="/w/:workspaceId/broadcasts/:broadcastId" element={<p>broadcast page</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

function renderTable(
  props: Partial<Parameters<typeof BroadcastsTable>[0]> = {},
  role: 'owner' | 'operator' = 'operator',
) {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/broadcasts`]}>
        <Where />
        <Routes>
          <Route
            path="/w/:workspaceId/broadcasts"
            element={<BroadcastsTable workspaceId={WS} {...props} />}
          />
          <Route path="/w/:workspaceId/broadcasts/:broadcastId" element={<p>broadcast page</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}
const rowsOf = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useBroadcastListStore.getState().clear();
  useAuthStore.getState().setAccount({ id: ME, email: 'me@x.io', display_name: 'Test User' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('SCR-24 Broadcasts list (AC-01)', () => {
  it('loading: six skeleton rows while the list is read', async () => {
    api.listBroadcasts.mockReturnValue(new Promise(() => undefined));
    renderTable();
    expect(await screen.findAllByTestId('broadcast-skeleton')).toHaveLength(6);
  });

  it('default: rows in the server order with name links, statuses, audiences and last change', async () => {
    api.listBroadcasts.mockResolvedValue(
      list([
        item(1, { name: 'Spring prices' }),
        item(2, {
          name: 'Autumn sale',
          status: 'sending',
          launched_at: ago(10 * 60_000),
          last_changed_by: ref(TEAMMATE, 'Olga Owner'),
        }),
        item(3, { name: 'Summer', status: 'sent', audience_size: 1 }),
        item(4, {
          name: 'Winter',
          status: 'stopped',
          last_changed_by: ref(TEAMMATE, 'Olga Owner'),
          ended_at: ago(60_000),
        }),
      ]),
    );
    renderTable();
    await screen.findByRole('link', { name: 'Spring prices' });
    expect(rowsOf().map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual([
      'Spring prices',
      'Autumn sale',
      'Summer',
      'Winter',
    ]);
    expect(screen.getByRole('link', { name: 'Spring prices' })).toHaveAttribute(
      'href',
      `/w/${WS}/broadcasts/${id(501)}`,
    );
    const spring = rowOf('Spring prices');
    expect(within(spring).getAllByText('Draft')[0]).toBeInTheDocument();
    expect(within(spring).getAllByText('38 contacts')[0]).toBeInTheDocument();
    expect(within(spring).getAllByText(/Test User · 3m/)[0]).toBeInTheDocument();
    const autumn = rowOf('Autumn sale');
    expect(within(autumn).getAllByText('Sending')[0]).toBeInTheDocument();
    expect(within(autumn).getAllByTestId('sending-dot')[0]).toHaveClass('animate-pulse');
    expect(within(autumn).getAllByText(/Launched by Olga Owner/)[0]).toBeInTheDocument();
    expect(within(rowOf('Summer')).getAllByText('Sent')[0]).toBeInTheDocument();
    expect(within(rowOf('Summer')).getAllByText('1 contact')[0]).toBeInTheDocument();
    const winter = rowOf('Winter');
    for (const badge of within(winter).getAllByText('Stopped'))
      expect(badge).toHaveClass('text-muted-foreground');
    expect(within(winter).getAllByText(/Stopped by Olga Owner/)[0]).toBeInTheDocument();
  });

  it('the last change carries the full date-time in its title', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: 'Spring prices' })]));
    renderTable();
    const text = (await screen.findAllByText(/Test User · 3m/))[0]!;
    expect(text.getAttribute('title')).toBe(new Date(ago(3 * 60_000)).toLocaleString());
  });

  it('a draft tag audience over 10 000 shows the count with the over-limit warning', async () => {
    api.listBroadcasts.mockResolvedValue(
      list([item(1, { name: 'Everyone', audience_size: 10420 })]),
    );
    renderTable();
    await screen.findByRole('link', { name: 'Everyone' });
    const row = rowOf('Everyone');
    expect(within(row).getAllByText(/10.420 contacts/)[0]).toBeInTheDocument();
    expect(
      within(row).getAllByTitle('Over the 10 000 limit — cannot be launched')[0],
    ).toBeInTheDocument();
  });

  it('names with markup render as plain text', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: '<b>Bold</b>' })]));
    renderTable();
    expect(await screen.findByRole('link', { name: '<b>Bold</b>' })).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('empty: the explanation and New broadcast, for every member', async () => {
    api.listBroadcasts.mockResolvedValue(list([]));
    renderPage('operator');
    expect(
      await screen.findByText(
        'No broadcasts yet. A broadcast sends one message from your business bot to a group of your contacts, chosen by tags or picked by hand.',
      ),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole('link', { name: 'New broadcast' });
    fireEvent.click(buttons.at(-1)!);
    expect(where()).toBe(`/w/${WS}/broadcasts/new`);
  });

  it('error: Couldn’t load broadcasts with Retry, which reads again', async () => {
    api.listBroadcasts.mockRejectedValueOnce(new Error('down'));
    renderTable();
    expect(await screen.findByText("Couldn't load broadcasts")).toBeInTheDocument();
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: 'Spring prices' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Spring prices' })).toBeInTheDocument();
  });

  it('live: a broadcast.changed frame re-reads; a status changes in place', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: 'Spring prices' })]));
    renderTable();
    await screen.findByRole('link', { name: 'Spring prices' });
    api.listBroadcasts.mockResolvedValue(
      list([item(1, { name: 'Spring prices', status: 'sending', launched_at: ago(0) })]),
    );
    await waitFor(() => expect(live.onFrame).not.toBeNull());
    act(() =>
      live.onFrame!({
        type: 'broadcast.changed',
        v: 1,
        workspace_id: WS,
        broadcast_id: id(501),
        change: 'status',
      } as LiveFrame),
    );
    expect((await within(rowOf('Spring prices')).findAllByText('Sending'))[0]).toBeInTheDocument();
  });

  it('a 401 / 403 on the read goes to the shell guard', async () => {
    const err = new ApiError(403, 'ACCESS_REMOVED', 'gone');
    api.listBroadcasts.mockRejectedValue(err);
    renderTable();
    await waitFor(() => expect(guard).toHaveBeenCalledWith(err, WS));
  });
});

describe('SCR-24 row actions (AC-07)', () => {
  const draft = (over: Partial<BroadcastDraft> = {}) =>
    ({ id: id(900), status: 'draft', ...over }) as BroadcastDraft;

  it('duplicates a draft as the same audience and opens the copy', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: 'Spring prices' })]));
    api.duplicateBroadcast.mockResolvedValue(draft());
    renderTable();
    await screen.findByRole('link', { name: 'Spring prices' });
    openMenu('Actions for Spring prices');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts/${id(900)}`));
    expect(api.duplicateBroadcast).toHaveBeenCalledWith(WS, id(501), {
      audience: 'same',
      include_not_confirmed: false,
    });
  });

  it('a failed duplicate says so', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: 'Spring prices' })]));
    api.duplicateBroadcast.mockRejectedValue(new Error('down'));
    renderTable();
    await screen.findByRole('link', { name: 'Spring prices' });
    openMenu('Actions for Spring prices');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(await screen.findByText("Couldn't duplicate the broadcast")).toBeInTheDocument();
    expect(where()).toBe(`/w/${WS}/broadcasts`);
  });

  it('a launched row opens the duplicate dialog (SCR-30) instead', async () => {
    const onDuplicateLaunched = vi.fn();
    const sent = item(1, { name: 'Summer', status: 'sent' });
    api.listBroadcasts.mockResolvedValue(list([sent]));
    renderTable({ onDuplicateLaunched });
    await screen.findByRole('link', { name: 'Summer' });
    openMenu('Actions for Summer');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(onDuplicateLaunched).toHaveBeenCalledWith(sent);
    expect(api.duplicateBroadcast).not.toHaveBeenCalled();
  });

  it("the author's own draft offers Delete, which opens the delete dialog (SCR-31)", async () => {
    const onDelete = vi.fn();
    const mine = item(1, { name: 'Mine' });
    api.listBroadcasts.mockResolvedValue(list([mine]));
    renderTable({ onDelete });
    await screen.findByRole('link', { name: 'Mine' });
    openMenu('Actions for Mine');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(mine);
  });

  it("an operator's row of a teammate's draft offers Duplicate only", async () => {
    api.listBroadcasts.mockResolvedValue(
      list([item(1, { name: 'Theirs', author: ref(TEAMMATE, 'Olga Owner') })]),
    );
    renderTable({ onDelete: vi.fn() }, 'operator');
    await screen.findByRole('link', { name: 'Theirs' });
    openMenu('Actions for Theirs');
    expect(await screen.findByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it("a business owner may delete a teammate's draft but never a launched broadcast", async () => {
    api.listBroadcasts.mockResolvedValue(
      list([
        item(1, { name: 'Theirs', author: ref(TEAMMATE, 'Olga') }),
        item(2, { name: 'Gone out', status: 'sent', author: ref(ME, 'Test User') }),
      ]),
    );
    renderTable({ onDelete: vi.fn(), onDuplicateLaunched: vi.fn() }, 'owner');
    await screen.findByRole('link', { name: 'Theirs' });
    openMenu('Actions for Theirs');
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    openMenu('Actions for Gone out');
    expect(await screen.findByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('SCR-24 on a phone', () => {
  it('stacks each row: audience and last change under the name, the wide columns hidden', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1, { name: 'Spring prices' })]));
    renderTable();
    await screen.findByRole('link', { name: 'Spring prices' });
    const stacked = within(rowOf('Spring prices')).getByTestId('phone-details');
    expect(stacked).toHaveClass('md:hidden');
    expect(within(stacked).getByText('38 contacts')).toBeInTheDocument();
    for (const header of ['Audience', 'Last change']) {
      expect(screen.getByRole('columnheader', { name: header })).toHaveClass(
        'hidden',
        'md:table-cell',
      );
    }
  });

  it('the page title row puts New broadcast full width on a phone', async () => {
    api.listBroadcasts.mockResolvedValue(list([item(1)]));
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Broadcasts' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New broadcast' })[0]).toHaveClass('w-full');
  });
});
