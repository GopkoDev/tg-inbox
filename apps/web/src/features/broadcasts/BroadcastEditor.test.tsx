import { ErrorCode, type BroadcastDraft, type LaunchedBroadcast, type LiveFrame } from '@tg/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { openMenu, stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  createBroadcast: vi.fn(),
  saveBroadcastFields: vi.fn(),
  saveBroadcastAudience: vi.fn(),
  getLaunchConfirmation: vi.fn(),
  duplicateBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
  listBroadcastGroup: vi.fn(),
  listBroadcastRecipients: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  createBroadcast: (...a: unknown[]) => api.createBroadcast(...a),
  saveBroadcastFields: (...a: unknown[]) => api.saveBroadcastFields(...a),
  saveBroadcastAudience: (...a: unknown[]) => api.saveBroadcastAudience(...a),
  getLaunchConfirmation: (...a: unknown[]) => api.getLaunchConfirmation(...a),
  duplicateBroadcast: (...a: unknown[]) => api.duplicateBroadcast(...a),
  deleteBroadcast: (...a: unknown[]) => api.deleteBroadcast(...a),
  listBroadcastGroup: (...a: unknown[]) => api.listBroadcastGroup(...a),
  listBroadcastRecipients: (...a: unknown[]) => api.listBroadcastRecipients(...a),
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

import { BroadcastDetailPage } from '@/pages/BroadcastDetailPage';
import { useBroadcastDraftStore } from './draft-store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ME = id(11);
const TEAMMATE = id(12);
const DRAFT = id(501);
const COPY = id(502);
const n = new Intl.NumberFormat();
const left = (k: number) => `${n.format(k)} characters left`;
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });

const draft = (over: Partial<BroadcastDraft> = {}): BroadcastDraft => ({
  id: DRAFT,
  workspace_id: WS,
  name: 'Spring prices',
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
  last_changed_at: '2026-10-23T09:00:00Z',
  created_at: '2026-10-23T09:00:00Z',
  status: 'draft',
  version: 3,
  text: 'New prices from Monday.',
  audience: { kind: 'tags', mode: 'any', tags: [], dropped_tags: [] },
  breakdown: {
    audience_size: 38,
    reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
  },
  ...over,
});

const launched = (): LaunchedBroadcast => ({
  id: DRAFT,
  workspace_id: WS,
  name: 'Spring prices',
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
  last_changed_at: '2026-10-23T09:00:00Z',
  created_at: '2026-10-23T09:00:00Z',
  status: 'sending',
  text: 'New prices from Monday.',
  audience: { kind: 'tags', mode: 'any', tags: [] },
  launched_by: ref(TEAMMATE, 'Olga Owner'),
  launched_at: '2026-10-23T09:05:00Z',
  launch_breakdown: {
    audience_size: 38,
    blocked_count: 2,
    never_wrote_count: 0,
    recipient_count: 36,
  },
  stopped_by: null,
  stopped_at: null,
  ended_at: null,
  end_reason: null,
  totals: {
    waiting: 36,
    sending: 0,
    delivered: 0,
    blocked: 0,
    failed: 0,
    not_confirmed: 0,
    stopped: 0,
  },
  not_reached_count: 0,
});

const guard = vi.fn();
const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
};
const where = () => screen.getByTestId('where').textContent;

function renderAt(path: string, role: 'owner' | 'operator' = 'owner') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/w/:workspaceId/broadcasts" element={<p>broadcasts list</p>} />
          <Route path="/w/:workspaceId/broadcasts/new" element={<BroadcastDetailPage />} />
          <Route path="/w/:workspaceId/broadcasts/:broadcastId" element={<BroadcastDetailPage />} />
          <Route
            path="/w/:workspaceId/broadcasts/:broadcastId/launch"
            element={<p>launch confirmation</p>}
          />
          <Route path="/w/:workspaceId/settings/bot" element={<p>bot settings</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

async function openDraft(d: BroadcastDraft = draft(), role: 'owner' | 'operator' = 'owner') {
  api.getBroadcast.mockResolvedValue(d);
  renderAt(`/w/${WS}/broadcasts/${d.id}`, role);
  await screen.findByRole('heading', { level: 1, name: d.name });
}

const nameField = () => screen.getByLabelText('Name');
const textField = () => screen.getByLabelText('Text');
const type = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useBroadcastDraftStore.getState().close();
  useBroadcastDraftStore.getState().forget();
  useAuthStore.getState().setAccount({ id: ME, email: 'me@x.io', display_name: 'Test User' });
});
afterEach(() => vi.useRealTimers());

describe('SCR-25 — new and loading (AC-01)', () => {
  it('loading: the two cards as skeletons', async () => {
    api.getBroadcast.mockReturnValue(new Promise(() => undefined));
    renderAt(`/w/${WS}/broadcasts/${DRAFT}`);
    expect(await screen.findAllByTestId('editor-skeleton')).toHaveLength(2);
  });

  it('new: empty fields, the Audience card disabled, no actions; a blank name creates nothing', async () => {
    renderAt(`/w/${WS}/broadcasts/new`);
    expect(screen.getByRole('heading', { level: 1, name: 'New broadcast' })).toBeInTheDocument();
    expect(nameField()).toHaveValue('');
    expect(textField()).toHaveValue('');
    expect(screen.getByText(left(4096))).toBeInTheDocument();
    expect(screen.getByText('Name the broadcast to start')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
    type(nameField(), '   ');
    expect(api.createBroadcast).not.toHaveBeenCalled();
  });

  it('created: the first valid name creates the draft and the address becomes its own', async () => {
    api.createBroadcast.mockResolvedValue(draft({ version: 1, text: 'Hi', name: 'Spring prices' }));
    api.getBroadcast.mockResolvedValue(draft({ version: 1, text: 'Hi', name: 'Spring prices' }));
    renderAt(`/w/${WS}/broadcasts/new`);
    fireEvent.change(textField(), { target: { value: 'Hi' } });
    type(nameField(), '  Spring prices ');
    await waitFor(() =>
      expect(api.createBroadcast).toHaveBeenCalledWith(WS, { name: 'Spring prices', text: 'Hi' }),
    );
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts/${DRAFT}`));
  });
});

describe('SCR-25 — the Message card (AC-02)', () => {
  it('the remaining length follows the shared rule: an emoji takes 2', async () => {
    await openDraft(draft({ text: '' }));
    expect(screen.getByText(left(4096))).toBeInTheDocument();
    fireEvent.change(textField(), { target: { value: '😀' } });
    expect(screen.getByText(left(4094))).toBeInTheDocument();
  });

  it('a text 5 over the limit shows the field error and sends nothing', async () => {
    await openDraft();
    type(textField(), 'a'.repeat(4101));
    expect(
      screen.getByText('The text must be 1 to 4096 characters as Telegram counts them — 5 over'),
    ).toBeInTheDocument();
    expect(textField()).toHaveAttribute('aria-invalid', 'true');
    expect(api.saveBroadcastFields).not.toHaveBeenCalled();
  });

  it('only spaces after a value: the field error, nothing saved', async () => {
    await openDraft();
    type(textField(), '   ');
    expect(
      screen.getByText('The text must be 1 to 4096 characters as Telegram counts them'),
    ).toBeInTheDocument();
    expect(api.saveBroadcastFields).not.toHaveBeenCalled();
  });

  it('an empty name: the field error, nothing saved', async () => {
    await openDraft();
    type(nameField(), '');
    expect(screen.getByText('A name must be 1 to 80 characters')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(api.saveBroadcastFields).not.toHaveBeenCalled();
  });

  it('saves as you go: Saving… then Saved, against the shown version', async () => {
    let resolve!: (d: BroadcastDraft) => void;
    api.saveBroadcastFields.mockReturnValue(new Promise((r) => (resolve = r)));
    await openDraft();
    type(textField(), 'Roses 20% off');
    expect(api.saveBroadcastFields).toHaveBeenCalledWith(WS, DRAFT, {
      expected_version: 3,
      text: 'Roses 20% off',
    });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => resolve(draft({ version: 4, text: 'Roses 20% off' })));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('saves after a pause in typing too', async () => {
    api.saveBroadcastFields.mockResolvedValue(draft({ version: 4, name: 'Autumn' }));
    await openDraft();
    vi.useFakeTimers();
    fireEvent.change(nameField(), { target: { value: 'Autumn' } });
    expect(api.saveBroadcastFields).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(800));
    expect(api.saveBroadcastFields).toHaveBeenCalledWith(WS, DRAFT, {
      expected_version: 3,
      name: 'Autumn',
    });
  });

  it("a failed save: «Couldn't save» with Retry, the edit kept", async () => {
    api.saveBroadcastFields.mockRejectedValueOnce(new Error('network'));
    api.saveBroadcastFields.mockResolvedValueOnce(draft({ version: 4, text: 'Mine' }));
    await openDraft();
    type(textField(), 'Mine');
    expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
    expect(textField()).toHaveValue('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.saveBroadcastFields).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it("stale save: the teammate's version shown, mine kept below with Use mine / Keep theirs", async () => {
    api.saveBroadcastFields.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', {
        draft: draft({ version: 5, text: 'Theirs' }),
      }),
    );
    api.saveBroadcastFields.mockResolvedValueOnce(draft({ version: 6, text: 'Mine' }));
    await openDraft();
    type(textField(), 'Mine');
    expect(
      await screen.findByText(
        'A teammate changed this draft. Their version is shown; your edit is kept below to apply again.',
      ),
    ).toBeInTheDocument();
    expect(textField()).toHaveValue('Theirs');
    expect(screen.getByTestId('mine-text')).toHaveTextContent('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Use mine' }));
    await waitFor(() =>
      expect(api.saveBroadcastFields).toHaveBeenLastCalledWith(WS, DRAFT, {
        expected_version: 5,
        text: 'Mine',
      }),
    );
    await waitFor(() => expect(textField()).toHaveValue('Mine'));
    expect(screen.queryByTestId('mine-text')).toBeNull();
  });

  it('Keep theirs drops the own edit', async () => {
    api.saveBroadcastFields.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', {
        draft: draft({ version: 5, name: 'Their name' }),
      }),
    );
    await openDraft();
    type(nameField(), 'My name');
    await screen.findByTestId('mine-name');
    fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
    expect(nameField()).toHaveValue('Their name');
    expect(screen.queryByTestId('mine-name')).toBeNull();
    expect(api.saveBroadcastFields).toHaveBeenCalledTimes(1);
  });

  it('the text is plain: markup and links are shown as typed', async () => {
    await openDraft(draft({ text: '<b>Hi</b> https://x.io' }));
    expect(textField()).toHaveValue('<b>Hi</b> https://x.io');
  });
});

describe('SCR-25 — breakdown and audience card (AC-01, AC-10)', () => {
  it('shows the draft breakdown', async () => {
    await openDraft();
    expect(screen.getByText('Would reach')).toBeInTheDocument();
    expect(screen.getByText('36')).toBeInTheDocument();
  });

  it('no bot: reach unknown; an owner gets the way to the bot settings, an operator does not', async () => {
    await openDraft(draft({ breakdown: { audience_size: 38, reach: null } }));
    expect(screen.getByText('Reach is known once a bot is connected.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open bot settings' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/bot`,
    );
  });

  it('no bot, operator: no settings link', async () => {
    await openDraft(draft({ breakdown: { audience_size: 38, reach: null } }), 'operator');
    expect(screen.getByText('Reach is known once a bot is connected.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open bot settings' })).toBeNull();
  });

  it('switching a tag audience to a hand-picked group saves at once', async () => {
    api.saveBroadcastAudience.mockResolvedValue(
      draft({ version: 4, audience: { kind: 'group', size: 0 } }),
    );
    api.listBroadcastGroup.mockResolvedValue({
      workspace_id: WS,
      broadcast_id: DRAFT,
      size: 0,
      items: [],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    await openDraft();
    fireEvent.click(screen.getByRole('radio', { name: 'Hand-picked group' }));
    await waitFor(() =>
      expect(api.saveBroadcastAudience).toHaveBeenCalledWith(WS, DRAFT, {
        kind: 'group',
        expected_version: 3,
      }),
    );
  });
});

describe('SCR-25 — title actions (AC-06, AC-07, AC-09, AC-10)', () => {
  it('owner: Launch, Duplicate and More → Delete', async () => {
    await openDraft(draft({ author: ref(TEAMMATE, 'Olga') }));
    expect(screen.getByRole('button', { name: 'Launch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    openMenu('More');
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).not.toHaveAttribute(
      'data-disabled',
    );
  });

  it("operator: no Launch, the owners-only note; Delete is disabled on a teammate's draft", async () => {
    await openDraft(draft({ author: ref(TEAMMATE, 'Olga') }), 'operator');
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
    expect(screen.getByText('Only a business owner launches broadcasts.')).toBeInTheDocument();
    openMenu('More');
    expect(
      await screen.findByRole('menuitem', {
        name: 'A draft is deleted by its author or a business owner',
      }),
    ).toHaveAttribute('data-disabled');
  });

  it('operator: Delete on their own draft opens SCR-31; deleting goes back to the list', async () => {
    api.deleteBroadcast.mockResolvedValue({ workspace_id: WS, broadcast_id: DRAFT });
    await openDraft(draft(), 'operator');
    openMenu('More');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/its audience of 38 contacts/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts`));
  });

  it('Duplicate opens the copy', async () => {
    api.duplicateBroadcast.mockResolvedValue(draft({ id: COPY, name: 'Copy of Spring prices' }));
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(api.duplicateBroadcast).toHaveBeenCalledWith(WS, DRAFT, {
      audience: 'same',
      include_not_confirmed: false,
    });
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts/${COPY}`));
  });

  it('Launch: checking, then the confirmation address', async () => {
    let resolve!: (v: unknown) => void;
    api.getLaunchConfirmation.mockReturnValue(new Promise((r) => (resolve = r)));
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(screen.getByTestId('launch-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
    await act(async () => resolve({}));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/broadcasts/${DRAFT}/launch`));
  });

  it.each([
    ['not_connected', 'Launching needs a connected bot.'],
    ['needs_token', "Your bot's token stopped working — replace it to launch."],
    ['taken_over', 'Your bot is connected elsewhere — reconnect it to launch.'],
  ] as const)(
    'refused, bot %s: the reason and the way to the bot settings',
    async (state, text) => {
      api.getLaunchConfirmation.mockRejectedValue(
        new ApiError(409, ErrorCode.BROADCAST_NEEDS_WORKING_BOT, 'x', { bot_state: state }),
      );
      await openDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
      const alert = await screen.findByText(text);
      expect(
        within(alert.closest('[role="alert"]') as HTMLElement).getByRole('link', {
          name: 'Open bot settings',
        }),
      ).toHaveAttribute('href', `/w/${WS}/settings/bot`);
      expect(where()).toBe(`/w/${WS}/broadcasts/${DRAFT}`);
    },
  );

  it('refused, too large: how many it holds', async () => {
    api.getLaunchConfirmation.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_AUDIENCE_TOO_LARGE, 'x', {
        limit: 10000,
        audience_size: 10420,
        can_add: 0,
      }),
    );
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(
      await screen.findByText(
        `A broadcast's audience can hold at most ${n.format(10000)} contacts — this one holds ${n.format(10420)}.`,
      ),
    ).toBeInTheDocument();
  });

  it('refused, nobody reachable: with the breakdown from the answer', async () => {
    api.getLaunchConfirmation.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_NO_REACHABLE_CONTACT, 'x', {
        breakdown: { audience_size: 3, blocked_count: 2, never_wrote_count: 1, recipient_count: 0 },
      }),
    );
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    const alert = (await screen.findByText('This audience has no reachable contact.')).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(within(alert).getByText('3 contacts')).toBeInTheDocument();
  });

  it('refused, daily limit: when the next launch is possible', async () => {
    api.getLaunchConfirmation.mockRejectedValue(
      new ApiError(429, ErrorCode.BROADCAST_LAUNCH_LIMIT_REACHED, 'x', {
        limit: 10,
        window_hours: 24,
        next_launch_at: '2026-10-24T14:20:00Z',
      }),
    );
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(
      await screen.findByText(
        /^A workspace can launch at most 10 broadcasts in 24 hours\. The next launch is possible at /,
      ),
    ).toBeInTheDocument();
    expect(nameField()).not.toBeDisabled();
  });

  it('refused, no text: the Text field says so and gets focus', async () => {
    api.getLaunchConfirmation.mockRejectedValue(
      new ApiError(400, ErrorCode.BROADCAST_TEXT_INVALID, 'x', {
        field: 'text',
        min_length: 1,
        max_length: 4096,
        length: 0,
      }),
    );
    await openDraft(draft({ text: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(await screen.findByText('Write the text before launching')).toBeInTheDocument();
    expect(textField()).toHaveFocus();
  });

  it('owners only (the role changed): the note replaces Launch', async () => {
    api.getLaunchConfirmation.mockRejectedValue(new ApiError(403, ErrorCode.OWNER_ONLY, 'x'));
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(
      await screen.findByText('Only a business owner launches broadcasts.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
  });
});

describe('SCR-25 — live and errors', () => {
  it('a teammate launched it: the read-only view with the notice', async () => {
    await openDraft();
    api.getBroadcast.mockResolvedValue(launched());
    // The read-only page (T35) then reads its report; it stays loading here.
    api.listBroadcastRecipients.mockReturnValue(new Promise(() => undefined));
    await act(async () =>
      live.onFrame?.({
        type: 'broadcast.changed',
        workspace_id: WS,
        broadcast_id: DRAFT,
        change: 'status',
      } as LiveFrame),
    );
    expect(await screen.findByTestId('broadcast-launched-view')).toBeInTheDocument();
    expect(
      screen.getByText('This broadcast was launched and can no longer be changed.'),
    ).toBeInTheDocument();
  });

  it('deleted while open: «This draft was deleted.»', async () => {
    await openDraft();
    await act(async () =>
      live.onFrame?.({
        type: 'broadcast.changed',
        workspace_id: WS,
        broadcast_id: DRAFT,
        change: 'deleted',
      } as LiveFrame),
    );
    expect(await screen.findByText('This draft was deleted.')).toBeInTheDocument();
  });

  it("the first read fails: «Couldn't load this broadcast» with Retry", async () => {
    api.getBroadcast.mockRejectedValueOnce(new Error('network'));
    api.getBroadcast.mockResolvedValueOnce(draft());
    renderAt(`/w/${WS}/broadcasts/${DRAFT}`);
    expect(await screen.findByText("Couldn't load this broadcast")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Spring prices' }),
    ).toBeInTheDocument();
  });
});
