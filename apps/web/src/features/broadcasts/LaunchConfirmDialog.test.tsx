import {
  ErrorCode,
  type BroadcastDraft,
  type LaunchConfirmation,
  type LaunchedBroadcast,
} from '@tg/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  getLaunchConfirmation: vi.fn(),
  launchBroadcast: vi.fn(),
  listBroadcastRecipients: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  getLaunchConfirmation: (...a: unknown[]) => api.getLaunchConfirmation(...a),
  launchBroadcast: (...a: unknown[]) => api.launchBroadcast(...a),
  listBroadcastRecipients: (...a: unknown[]) => api.listBroadcastRecipients(...a),
}));
vi.mock('@/features/tags/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tags/api')>()),
  listTags: async () => ({ items: [] }),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { BroadcastDetailPage } from '@/pages/BroadcastDetailPage';
import { useBroadcastDraftStore } from './draft-store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ME = id(11);
const DRAFT = id(501);
const ref = (account_id: string, display_name: string) => ({ account_id, display_name });
const FP1 = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);
const TEXT = 'New prices <b>from</b> Monday.\nSee https://acme.example';

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
  text: TEXT,
  audience: { kind: 'tags', mode: 'any', tags: [], dropped_tags: [] },
  breakdown: {
    audience_size: 38,
    reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
  },
  ...over,
});

const confirmation = (over: Partial<LaunchConfirmation> = {}): LaunchConfirmation => ({
  broadcast_id: DRAFT,
  version: 3,
  name: 'Spring prices',
  text: TEXT,
  breakdown: { audience_size: 38, blocked_count: 2, never_wrote_count: 0, recipient_count: 36 },
  fingerprint: FP1,
  ...over,
});

const launched = (): LaunchedBroadcast => ({
  id: DRAFT,
  workspace_id: WS,
  name: 'Spring prices',
  author: ref(ME, 'Test User'),
  last_changed_by: ref(ME, 'Test User'),
  last_changed_at: '2026-10-23T09:05:00Z',
  created_at: '2026-10-23T09:00:00Z',
  status: 'sending',
  text: TEXT,
  audience: { kind: 'tags', mode: 'any', tags: [] },
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
const draftUrl = `/w/${WS}/broadcasts/${DRAFT}`;
const launchUrl = `${draftUrl}/launch`;

function renderAt(path: string, role: 'owner' | 'operator' = 'owner') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/w/:workspaceId/broadcasts/:broadcastId" element={<BroadcastDetailPage />} />
          <Route
            path="/w/:workspaceId/broadcasts/:broadcastId/launch"
            element={<BroadcastDetailPage />}
          />
          <Route path="/w/:workspaceId/settings/bot" element={<p>bot settings</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}

async function openLaunch(c: LaunchConfirmation = confirmation()) {
  api.getBroadcast.mockResolvedValue(draft());
  api.getLaunchConfirmation.mockResolvedValue(c);
  renderAt(launchUrl);
  return screen.findByRole('alertdialog');
}

const sendButton = (n = 36) => screen.getByRole('button', { name: `Send to ${n} contacts` });

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  useBroadcastDraftStore.getState().close();
  useBroadcastDraftStore.getState().forget();
  useAuthStore.getState().setAccount({ id: ME, email: 'me@x.io', display_name: 'Test User' });
  api.listBroadcastRecipients.mockResolvedValue({
    workspace_id: WS,
    broadcast_id: DRAFT,
    items: [],
    has_next: false,
    next_cursor: null,
  });
});

describe('SCR-27 — the launch confirmation (AC-06)', () => {
  it('default: the exact text as plain text, Send to 36 with who is left out, the warning; Cancel focused', async () => {
    const dialog = await openLaunch();
    expect(await within(dialog).findByText(/This message goes to/)).toHaveTextContent(
      'This message goes to 36 contacts from your business bot:',
    );
    const box = within(dialog).getByTestId('launch-text');
    expect(box.textContent).toBe(TEXT);
    expect(box).toHaveClass('whitespace-pre-wrap');
    expect(within(box).queryByRole('link')).toBeNull();
    expect(box.querySelector('b')).toBeNull();
    const lines = within(dialog).getByLabelText('Count breakdown');
    expect(within(lines).getByText('Left out — blocked the bot').nextSibling).toHaveTextContent(
      '2',
    );
    expect(
      within(dialog).getByText(
        'Customers who did not expect this message can block or report the bot. That can limit the bot for support too.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    );
    expect(api.getLaunchConfirmation).toHaveBeenCalledWith(WS, DRAFT);
  });

  it('loading: skeleton lines until the confirmation answers', async () => {
    let answer!: (c: LaunchConfirmation) => void;
    api.getBroadcast.mockResolvedValue(draft());
    api.getLaunchConfirmation.mockReturnValue(new Promise((r) => (answer = r)));
    renderAt(launchUrl);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getAllByTestId('launch-skeleton').length).toBeGreaterThan(0);
    await act(async () => answer(confirmation()));
    expect(await within(dialog).findByTestId('launch-text')).toBeInTheDocument();
  });

  it('launch sends the shown version and fingerprint once, even on a double click, then opens the broadcast', async () => {
    let answer!: (v: unknown) => void;
    api.launchBroadcast.mockReturnValue(new Promise((r) => (answer = r)));
    await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(sendButton());
    fireEvent.click(sendButton());
    expect(api.launchBroadcast).toHaveBeenCalledTimes(1);
    expect(api.launchBroadcast).toHaveBeenCalledWith(WS, DRAFT, {
      expected_version: 3,
      fingerprint: FP1,
    });
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    api.getBroadcast.mockResolvedValue(launched());
    await act(async () => answer({ outcome: 'launched', broadcast: launched() }));
    await waitFor(() => expect(where()).toBe(draftUrl));
    expect(await screen.findByTestId('broadcast-launched-view')).toBeInTheDocument();
  });

  it('already launched (a second owner): opens the broadcast too', async () => {
    api.launchBroadcast.mockResolvedValue({ outcome: 'already_launched', broadcast: launched() });
    await openLaunch();
    await screen.findByTestId('launch-text');
    api.getBroadcast.mockResolvedValue(launched());
    fireEvent.click(sendButton());
    await waitFor(() => expect(where()).toBe(draftUrl));
  });

  it('asks again on BROADCAST_AUDIENCE_CHANGED with the current numbers; the next confirm sends exactly them', async () => {
    const current = confirmation({
      version: 3,
      fingerprint: FP2,
      breakdown: { audience_size: 39, blocked_count: 2, never_wrote_count: 0, recipient_count: 37 },
    });
    api.launchBroadcast
      .mockRejectedValueOnce(
        new ApiError(409, ErrorCode.BROADCAST_AUDIENCE_CHANGED, 'changed', {
          confirmation: current,
        }),
      )
      .mockResolvedValueOnce({ outcome: 'launched', broadcast: launched() });
    await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(
        'The contacts this broadcast would reach changed. Check the number and confirm again.',
      ),
    ).toBeInTheDocument();
    expect(sendButton(37)).toBeEnabled();
    api.getBroadcast.mockResolvedValue(launched());
    fireEvent.click(sendButton(37));
    await waitFor(() => expect(api.launchBroadcast).toHaveBeenCalledTimes(2));
    expect(api.launchBroadcast.mock.calls[1]![2]).toEqual({
      expected_version: 3,
      fingerprint: FP2,
    });
    expect(api.getLaunchConfirmation).toHaveBeenCalledTimes(1);
  });

  it('asks again on BROADCAST_DRAFT_CHANGED: re-reads the confirmation with the new text and count', async () => {
    api.launchBroadcast.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', {
        draft: draft({ version: 4 }),
      }),
    );
    await openLaunch();
    await screen.findByTestId('launch-text');
    api.getLaunchConfirmation.mockResolvedValue(
      confirmation({ version: 4, text: 'Prices change on Tuesday.', fingerprint: FP2 }),
    );
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(
        'This draft was changed by a teammate. Check the text and number and confirm again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('launch-text').textContent).toBe('Prices change on Tuesday.');
    api.launchBroadcast.mockResolvedValue({ outcome: 'launched', broadcast: launched() });
    api.getBroadcast.mockResolvedValue(launched());
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(api.launchBroadcast.mock.calls.at(-1)![2]).toEqual({
        expected_version: 4,
        fingerprint: FP2,
      }),
    );
  });

  it('refused at confirm time, no working bot: the reason with Open bot settings, only Close remains', async () => {
    api.launchBroadcast.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_NEEDS_WORKING_BOT, 'bot', { bot_state: 'needs_token' }),
    );
    const dialog = await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(sendButton());
    expect(
      await within(dialog).findByText("Your bot's token stopped working — replace it to launch."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open bot settings' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Send to/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(where()).toBe(draftUrl));
  });

  it('refused at confirm time, the daily limit: when the next launch is possible', async () => {
    api.launchBroadcast.mockRejectedValue(
      new ApiError(429, ErrorCode.BROADCAST_LAUNCH_LIMIT_REACHED, 'limit', {
        limit: 10,
        next_launch_at: '2026-10-24T14:20:00Z',
      }),
    );
    const dialog = await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(sendButton());
    expect(
      await within(dialog).findByText(
        /^A workspace can launch at most 10 broadcasts in 24 hours\. The next launch is possible at /,
      ),
    ).toBeInTheDocument();
  });

  it("error: «Couldn't send the broadcast. Nothing was sent.» and the confirm enabled again", async () => {
    api.launchBroadcast.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'));
    await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(sendButton());
    expect(
      await screen.findByText("Couldn't send the broadcast. Nothing was sent."),
    ).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  it('owner deactivated: ACCESS_REMOVED goes to the guard, nothing launched', async () => {
    const removed = new ApiError(403, ErrorCode.ACCESS_REMOVED, 'removed');
    api.launchBroadcast.mockRejectedValue(removed);
    await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(sendButton());
    await waitFor(() => expect(guard).toHaveBeenCalledWith(removed, WS));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Cancel: the address returns to the draft and focus to Launch', async () => {
    await openLaunch();
    await screen.findByTestId('launch-text');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(where()).toBe(draftUrl));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch' })).toHaveFocus());
    expect(api.launchBroadcast).not.toHaveBeenCalled();
  });
});

describe('SCR-27 — the /launch address (AC-07, AC-09)', () => {
  it('a pre-check refusal never opens the dialog: the draft shows it at its own address', async () => {
    api.getBroadcast.mockResolvedValue(draft());
    api.getLaunchConfirmation.mockRejectedValue(
      new ApiError(409, ErrorCode.BROADCAST_NO_REACHABLE_CONTACT, 'nobody', {
        breakdown: { audience_size: 3, blocked_count: 3, never_wrote_count: 0, recipient_count: 0 },
      }),
    );
    renderAt(launchUrl);
    expect(await screen.findByText('This audience has no reachable contact.')).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe(draftUrl));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('an operator on a saved /launch link: the draft at its own address with the owners-only note, nothing asked', async () => {
    api.getBroadcast.mockResolvedValue(draft());
    renderAt(launchUrl, 'operator');
    expect(
      await screen.findByText('Only a business owner launches broadcasts.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe(draftUrl));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.getLaunchConfirmation).not.toHaveBeenCalled();
  });

  it('OWNER_ONLY from the confirmation read (the role changed): the draft with the note', async () => {
    api.getBroadcast.mockResolvedValue(draft());
    api.getLaunchConfirmation.mockRejectedValue(
      new ApiError(403, ErrorCode.OWNER_ONLY, 'owners only'),
    );
    renderAt(launchUrl);
    expect(
      await screen.findByText('Only a business owner launches broadcasts.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe(draftUrl));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('SCR-27 — phone (< sm)', () => {
  it('the buttons stack with the confirm first', async () => {
    const dialog = await openLaunch();
    await screen.findByTestId('launch-text');
    const footer = within(dialog).getByTestId('launch-footer');
    expect(footer).toHaveClass('flex-col-reverse');
  });
});
