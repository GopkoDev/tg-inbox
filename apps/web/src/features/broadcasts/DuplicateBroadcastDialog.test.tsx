import { ErrorCode, type BroadcastDraft, type LaunchedBroadcast } from '@tg/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { openMenu, stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  duplicateBroadcast: vi.fn(),
  getBroadcast: vi.fn(),
  listBroadcasts: vi.fn(),
  listBroadcastRecipients: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  duplicateBroadcast: (...a: unknown[]) => api.duplicateBroadcast(...a),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  listBroadcasts: (...a: unknown[]) => api.listBroadcasts(...a),
  listBroadcastRecipients: (...a: unknown[]) => api.listBroadcastRecipients(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { BroadcastDetailPage } from '@/pages/BroadcastDetailPage';
import { BroadcastsTable } from './BroadcastsTable';
import { DuplicateBroadcastDialog } from './DuplicateBroadcastDialog';
import { useBroadcastDraftStore } from './draft-store';
import { useBroadcastListStore } from './list-store';
import { useBroadcastReportStore } from './report-store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ME = id(11);
const SOURCE = id(501);
const COPY = id(901);
const VIP = id(301);
const STAFF = id(302);
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });

const broadcast = (over: Partial<LaunchedBroadcast> = {}): LaunchedBroadcast => ({
  id: SOURCE,
  workspace_id: WS,
  name: 'Spring prices',
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
  last_changed_at: '2026-10-23T09:05:00Z',
  created_at: '2026-10-23T09:00:00Z',
  status: 'sent',
  text: 'New prices from Monday.',
  audience: {
    kind: 'tags',
    mode: 'any',
    tags: [
      { tag_id: VIP, name: 'VIP', kind: 'include' },
      { tag_id: STAFF, name: 'Staff', kind: 'exclude' },
    ],
  },
  launched_by: ref(ME, 'Test User'),
  launched_at: '2026-10-23T09:05:00Z',
  launch_breakdown: {
    audience_size: 38,
    blocked_count: 2,
    never_wrote_count: 0,
    recipient_count: 36,
  },
  stopped_by: null,
  stopped_at: null,
  ended_at: '2026-10-23T09:10:00Z',
  end_reason: 'completed',
  totals: {
    waiting: 0,
    sending: 0,
    delivered: 31,
    blocked: 1,
    failed: 1,
    not_confirmed: 3,
    stopped: 0,
  },
  not_reached_count: 2,
  ...over,
});
const copy = () => ({ id: COPY, name: 'Copy of Spring prices', status: 'draft' }) as BroadcastDraft;

const guard = vi.fn();
const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
};
const where = () => screen.getByTestId('where').textContent;

function Host({ source }: { source: LaunchedBroadcast }) {
  const [open, setOpen] = useState<LaunchedBroadcast | null>(source);
  return (
    <DuplicateBroadcastDialog workspaceId={WS} broadcast={open} onClose={() => setOpen(null)} />
  );
}

function renderDialog(source: LaunchedBroadcast = broadcast()) {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[`/w/${WS}/broadcasts/${SOURCE}`]}>
        <Where />
        <Routes>
          <Route
            path="/w/:workspaceId/broadcasts/:broadcastId"
            element={<Host source={source} />}
          />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

const option = (name: string | RegExp) => screen.getByRole('radio', { name });
const create = () => screen.getByRole('button', { name: 'Create draft' });

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useAuthStore.getState().setAccount({ id: ME, email: 'me@x.io', display_name: 'Test User' });
});

describe('SCR-30 — duplicate a launched broadcast (AC-13)', () => {
  it('default for a tag audience: the three choices with their counts, the same tags preselected', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Duplicate “Spring prices”' }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('radiogroup', { name: 'Who should the copy go to?' }),
    ).toBeVisible();
    expect(option(/The same tags/)).toBeChecked();
    expect(
      within(dialog).getByText('Any of VIP · leaving out Staff — counted again when you launch'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        '36 contacts — those who blocked the bot stay in the group, counted as unreachable',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('2 contacts whose send failed for a reason a new attempt can fix'),
    ).toBeInTheDocument();
    expect(option(/Only recipients it didn't reach/)).toBeEnabled();
  });

  it('a group audience: no same-tags choice, all recipients preselected', async () => {
    renderDialog(broadcast({ audience: { kind: 'group' } }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('radio', { name: /The same tags/ })).toBeNull();
    expect(option(/All recipients/)).toBeChecked();
  });

  it('created: posts the choice, closes and opens the copy', async () => {
    api.duplicateBroadcast.mockResolvedValue(copy());
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(option(/All recipients/));
    fireEvent.click(create());
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts/${COPY}`));
    expect(api.duplicateBroadcast).toHaveBeenCalledWith(WS, SOURCE, {
      audience: 'all_recipients',
      include_not_confirmed: false,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the same tags posts same_tags', async () => {
    api.duplicateBroadcast.mockResolvedValue(copy());
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(create());
    await waitFor(() =>
      expect(api.duplicateBroadcast).toHaveBeenCalledWith(WS, SOURCE, {
        audience: 'same_tags',
        include_not_confirmed: false,
      }),
    );
  });

  it('not reached: disabled while the broadcast still sends, with its reason', async () => {
    renderDialog(broadcast({ status: 'sending', ended_at: null, end_reason: null }));
    await screen.findByRole('dialog');
    expect(option(/Only recipients it didn't reach/)).toBeDisabled();
    expect(screen.getByText('Available once the broadcast has ended')).toBeInTheDocument();
  });

  it('not reached with not confirmed recipients: the opt-in and its warning, sent as include_not_confirmed', async () => {
    api.duplicateBroadcast.mockResolvedValue(copy());
    renderDialog();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(option(/Only recipients it didn't reach/));
    const box = screen.getByRole('checkbox', {
      name: 'Also include 3 recipients whose send was not confirmed',
    });
    expect(box).not.toBeChecked();
    expect(screen.getByText('They may already have received it.')).toBeInTheDocument();
    fireEvent.click(box);
    fireEvent.click(create());
    await waitFor(() =>
      expect(api.duplicateBroadcast).toHaveBeenCalledWith(WS, SOURCE, {
        audience: 'not_reached',
        include_not_confirmed: true,
      }),
    );
  });

  it('not reached with none not confirmed: no opt-in', async () => {
    renderDialog(broadcast({ totals: { ...broadcast().totals, not_confirmed: 0 } }));
    await screen.findByRole('dialog');
    fireEvent.click(option(/Only recipients it didn't reach/));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a stopped broadcast offers not reached', async () => {
    renderDialog(broadcast({ status: 'stopped', end_reason: 'stopped' }));
    await screen.findByRole('dialog');
    expect(option(/Only recipients it didn't reach/)).toBeEnabled();
  });

  it('did not reach 0 contacts still reads «0 contacts»', async () => {
    renderDialog(broadcast({ not_reached_count: 0 }));
    await screen.findByRole('dialog');
    expect(
      screen.getByText('0 contacts whose send failed for a reason a new attempt can fix'),
    ).toBeInTheDocument();
  });

  it('creating: a spinner, the buttons disabled', async () => {
    let answer!: (d: BroadcastDraft) => void;
    api.duplicateBroadcast.mockReturnValue(new Promise((r) => (answer = r)));
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(create());
    await waitFor(() => expect(create()).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    await act(async () => answer(copy()));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts/${COPY}`));
  });

  it('refused, not ended (a stale page): the option turns disabled with the notice', async () => {
    api.duplicateBroadcast.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_NOT_ENDED, 'still sending', {
        broadcast_id: SOURCE,
        status: 'sending',
      }),
    );
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(option(/Only recipients it didn't reach/));
    fireEvent.click(create());
    expect(
      await screen.findByText('It is still sending — choose another option or wait until it ends.'),
    ).toBeInTheDocument();
    expect(option(/Only recipients it didn't reach/)).toBeDisabled();
    expect(option(/Only recipients it didn't reach/)).not.toBeChecked();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("error: «Couldn't create the copy»", async () => {
    api.duplicateBroadcast.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'));
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(create());
    expect(await screen.findByText("Couldn't create the copy")).toBeInTheDocument();
    expect(create()).toBeEnabled();
  });

  it('access removed: the dialog closes and the guard takes over', async () => {
    const removed = new ApiError(403, ErrorCode.ACCESS_REMOVED, 'removed');
    api.duplicateBroadcast.mockRejectedValue(removed);
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(create());
    await waitFor(() => expect(guard).toHaveBeenCalledWith(removed, WS));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancel closes and creates nothing', async () => {
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.duplicateBroadcast).not.toHaveBeenCalled();
  });
});

describe('SCR-30 openers', () => {
  beforeEach(() => {
    useBroadcastDraftStore.getState().close();
    useBroadcastDraftStore.getState().forget();
    useBroadcastReportStore.getState().close();
    useBroadcastListStore.getState().clear();
    api.listBroadcastRecipients.mockResolvedValue({
      workspace_id: WS,
      broadcast_id: SOURCE,
      items: [],
      has_next: false,
      next_cursor: null,
    });
  });

  it('SCR-28: Duplicate opens the dialog for the broadcast shown', async () => {
    api.getBroadcast.mockResolvedValue(broadcast());
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
    render(
      <ShellGuardContext.Provider value={guard}>
        <MemoryRouter initialEntries={[`/w/${WS}/broadcasts/${SOURCE}`]}>
          <Routes>
            <Route
              path="/w/:workspaceId/broadcasts/:broadcastId"
              element={<BroadcastDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </ShellGuardContext.Provider>,
    );
    await screen.findByTestId('broadcast-report');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(
      await screen.findByRole('heading', { name: 'Duplicate “Spring prices”' }),
    ).toBeInTheDocument();
  });

  it('SCR-24: a launched row reads the broadcast and opens the dialog', async () => {
    api.listBroadcasts.mockResolvedValue({
      workspace_id: WS,
      items: [
        {
          id: SOURCE,
          name: 'Spring prices',
          status: 'sent',
          audience_kind: 'tags',
          audience_size: 38,
          author: ref(ME, 'Test User'),
          last_changed_by: ref(ME, 'Test User'),
          last_changed_at: '2026-10-23T09:05:00Z',
          launched_at: '2026-10-23T09:05:00Z',
          ended_at: '2026-10-23T09:10:00Z',
        },
      ],
    });
    api.getBroadcast.mockResolvedValue(broadcast());
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
    render(
      <ShellGuardContext.Provider value={guard}>
        <MemoryRouter initialEntries={[`/w/${WS}/broadcasts`]}>
          <Routes>
            <Route
              path="/w/:workspaceId/broadcasts"
              element={<BroadcastsTable workspaceId={WS} />}
            />
          </Routes>
        </MemoryRouter>
      </ShellGuardContext.Provider>,
    );
    await screen.findByRole('link', { name: 'Spring prices' });
    openMenu('Actions for Spring prices');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(
      await screen.findByRole('heading', { name: 'Duplicate “Spring prices”' }),
    ).toBeInTheDocument();
    expect(api.getBroadcast.mock.calls[0]!.slice(0, 2)).toEqual([WS, SOURCE]);
    expect(api.duplicateBroadcast).not.toHaveBeenCalled();
  });
});
