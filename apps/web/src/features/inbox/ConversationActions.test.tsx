import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ConversationSummary, ThreadActivity } from '@tg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const api = {
  listActiveMembers: vi.fn(),
  closeConversation: vi.fn(),
  reopenConversation: vi.fn(),
  assignConversation: vi.fn(),
  unassignConversation: vi.fn(),
};
vi.mock('./api-source', () => ({
  listActiveMembers: (...a: unknown[]) => api.listActiveMembers(...a),
  closeConversation: (...a: unknown[]) => api.closeConversation(...a),
  reopenConversation: (...a: unknown[]) => api.reopenConversation(...a),
  assignConversation: (...a: unknown[]) => api.assignConversation(...a),
  unassignConversation: (...a: unknown[]) => api.unassignConversation(...a),
}));

import { stubRadixDom } from '@/test/radix';
import { useAuthStore } from '@/features/auth/store';
import { ConversationActions } from './ConversationActions';
import { useInboxStore } from './store';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WS = id(1);
const CONV = id(101);
const bob = { account_id: id(2), display_name: 'Bob Petrenko' };

const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: CONV,
  workspace_id: WS,
  contact: { id: id(900), first_name: 'Ada', last_name: null, username: null },
  last_activity_at: '2026-10-18T10:05:00.000Z',
  last_item: { type: 'message', id: id(500), kind: 'text', body: 'hi' },
  unread_count: 0,
  waiting_for_reply: false,
  status: 'open',
  assignee: null,
  state_version: 3,
  close_snapshot: { customer_message_seq: 1, latest_reply: null },
  ...over,
});

function show(s: ConversationSummary | null) {
  useInboxStore.setState({
    workspaceId: WS,
    thread: {
      conversationId: CONV,
      status: 'ready',
      contact: s?.contact ?? null,
      summary: s,
      older: 'idle',
      items: [],
      hasPrev: false,
      prevCursor: null,
      readThroughAt: null,
    },
  });
}
const renderBar = (props = {}) =>
  render(<ConversationActions workspaceId={WS} conversationId={CONV} {...props} />);

const change = (over: Partial<ConversationSummary>, outcome = 'recorded') => ({
  workspace_id: WS,
  outcome,
  conversation: summary(over),
  activity: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  useInboxStore.getState().leave();
});
afterEach(() => vi.useRealTimers());

describe('SCR-02 actions bar', () => {
  it('open: Open badge, Unassigned button and Close', () => {
    show(summary());
    renderBar();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('closed: Closed badge, assignee as plain text, Reopen instead of Close', () => {
    show(summary({ status: 'closed', assignee: { ...bob, display_name: '<b>Bob</b>' } }));
    renderBar();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /<b>Bob<\/b>/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('loading: a skeleton and no controls until the summary arrives', () => {
    show(null);
    renderBar();
    expect(screen.getByTestId('actions-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('pending: the used control spins and all three are disabled', async () => {
    show(summary());
    let finish: (v: unknown) => void = () => {};
    api.closeConversation.mockReturnValue(new Promise((r) => (finish = r)));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled());
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeDisabled();
    expect(screen.getByTestId('action-spinner')).toBeInTheDocument();
    await act(async () => finish(change({ status: 'closed', state_version: 4 })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reopen' })).toBeEnabled());
    expect(screen.queryByTestId('action-spinner')).toBeNull();
  });

  it('recorded: the header follows the answer (Closed, Reopen)', async () => {
    show(summary());
    api.closeConversation.mockResolvedValue(change({ status: 'closed', state_version: 4 }));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('unchanged: the header shows the answer and nothing else appears', async () => {
    show(summary({ status: 'closed' }));
    api.reopenConversation.mockResolvedValue(
      change({ status: 'open', state_version: 5 }, 'unchanged'),
    );
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('close asks first: the owner is told, nothing else shown', async () => {
    show(summary());
    api.closeConversation.mockRejectedValue(
      new ApiError(409, 'CLOSE_NEEDS_CONFIRMATION', 'x', {
        conversation: summary(),
        reasons: ['customer_waiting'],
        stale_change: null,
        newest_unread_message: null,
      }),
    );
    const onResult = vi.fn();
    renderBar({ onResult });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        'close',
        expect.objectContaining({ kind: 'needs_confirmation' }),
      ),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('change limit: warning with a countdown, controls disabled, then it goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
    show(summary());
    api.closeConversation.mockRejectedValue(
      new ApiError(429, 'CHANGE_LIMIT_REACHED', 'x', {
        limit: 60,
        window_seconds: 60,
        retry_at: '2026-10-18T10:00:03.000Z',
      }),
    );
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      await screen.findByText(
        'Changes are limited to 60 per minute — you can continue in 3 seconds',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/you can continue in 2 seconds/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText(/Changes are limited/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('change failed: an alert, controls enabled, version kept for the next try', async () => {
    show(summary());
    api.closeConversation.mockRejectedValueOnce(new TypeError('network'));
    api.closeConversation.mockResolvedValueOnce(change({ status: 'closed', state_version: 4 }));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      await screen.findByText("Couldn't save the change — check your connection and try again"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await screen.findByRole('button', { name: 'Reopen' });
    expect(api.closeConversation.mock.calls[1]![2]).toEqual(
      expect.objectContaining({ expected_state_version: 3 }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('live: a teammate or automatic change replaces the header', () => {
    show(summary({ assignee: bob }));
    renderBar();
    expect(screen.getByRole('button', { name: /Bob Petrenko/ })).toBeInTheDocument();
    act(() => show(summary({ status: 'closed', assignee: null, state_version: 4 })));
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('phone: the bar is laid out as its own row with a flexible assignee button', () => {
    show(summary({ assignee: bob }));
    renderBar({ compact: true });
    expect(screen.getByTestId('conversation-actions')).toHaveClass('w-full');
    expect(screen.getByRole('button', { name: /Bob Petrenko/ })).toHaveClass('flex-1');
  });
});

describe('SCR-11 over the actions bar (AC-03)', () => {
  const ana = { account_id: id(5), display_name: 'Ana Shevchenko' };
  const stale = (over: Partial<ConversationSummary>, latest: Partial<ThreadActivity> | null) =>
    new ApiError(409, 'CONVERSATION_STATE_CHANGED', 'x', {
      conversation: summary(over),
      latest_change: latest
        ? {
            type: 'activity',
            id: id(700),
            workspace_id: WS,
            conversation_id: CONV,
            kind: 'assigned',
            cause: 'member',
            actor: bob,
            previous_assignee: null,
            new_assignee: bob,
            position_at: new Date(Date.now() - 120_000).toISOString(),
            ...latest,
          }
        : null,
    });
  const dialog = () => screen.getByRole('alertdialog');

  beforeEach(() => {
    stubRadixDom();
    useAuthStore
      .getState()
      .setAccount({ id: ana.account_id, email: 'a@x.io', display_name: ana.display_name });
    api.listActiveMembers.mockResolvedValue({ workspace_id: WS, items: [ana, bob] });
  });

  it('reopen: the refusal opens the dialog; the go-ahead resends the version it showed', async () => {
    show(summary({ status: 'closed', state_version: 3 }));
    api.reopenConversation
      .mockRejectedValueOnce(
        stale({ status: 'closed', assignee: bob, state_version: 7 }, { kind: 'assigned' }),
      )
      .mockResolvedValueOnce(change({ status: 'open', state_version: 8 }));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByRole('alertdialog', { name: 'This conversation changed since you looked' });
    expect(
      within(dialog()).getByText('Now: assigned to Bob Petrenko · Closed'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reopen anyway' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.reopenConversation).toHaveBeenLastCalledWith(
      WS,
      CONV,
      { expected_state_version: 7 },
      {},
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('assign: keeps the pick; Leave it closes and the header shows the newer state', async () => {
    show(summary());
    api.assignConversation.mockRejectedValueOnce(stale({ assignee: bob, state_version: 4 }, {}));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Unassigned/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Me \(Ana/ }));
    await screen.findByRole('alertdialog');
    expect(
      within(dialog()).getByRole('button', { name: 'Assign to Ana Shevchenko' }),
    ).toBeEnabled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Leave it' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.assignConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Bob Petrenko/ })).toBeEnabled();
  });

  it('assign go-ahead: pending locks the dialog, then 200 closes it', async () => {
    show(summary());
    api.assignConversation.mockRejectedValueOnce(stale({ assignee: bob, state_version: 4 }, {}));
    let finish: (v: unknown) => void = () => {};
    api.assignConversation.mockReturnValueOnce(new Promise((r) => (finish = r)));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Unassigned/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Me \(Ana/ }));
    await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Assign to Ana Shevchenko' }));
    await waitFor(() => expect(within(dialog()).getByTestId('dialog-spinner')).toBeInTheDocument());
    expect(within(dialog()).getByRole('button', { name: 'Leave it' })).toBeDisabled();
    expect(api.assignConversation).toHaveBeenLastCalledWith(
      WS,
      CONV,
      { assignee_account_id: ana.account_id, expected_state_version: 4 },
      {},
    );
    await act(async () => finish(change({ assignee: ana, state_version: 5 })));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('button', { name: /Ana Shevchenko/ })).toBeInTheDocument();
  });

  it('unassign go-ahead answered unchanged: the dialog closes, the header shows the answer', async () => {
    show(summary({ assignee: bob }));
    api.unassignConversation
      .mockRejectedValueOnce(
        stale(
          { assignee: ana, state_version: 4 },
          { kind: 'unassigned', previous_assignee: ana, new_assignee: null },
        ),
      )
      .mockResolvedValueOnce(change({ assignee: null, state_version: 5 }, 'unchanged'));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Bob Petrenko/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unassign' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Unassign anyway' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeInTheDocument();
  });

  it('asks again: a second refusal replaces the lines and keeps the dialog', async () => {
    show(summary({ status: 'closed' }));
    api.reopenConversation
      .mockRejectedValueOnce(stale({ status: 'closed', assignee: bob, state_version: 4 }, {}))
      .mockRejectedValueOnce(
        stale(
          { status: 'closed', assignee: ana, state_version: 5 },
          {
            kind: 'reassigned',
            actor: ana,
            previous_assignee: bob,
            new_assignee: ana,
          },
        ),
      );
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reopen anyway' }));
    await screen.findByText('It changed again — check before going ahead.');
    expect(
      within(dialog()).getByText('Now: assigned to Ana Shevchenko · Closed'),
    ).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Reopen anyway' })).toBeEnabled();
  });

  it('refused not an active member: the dialog closes and SCR-10 reopens refused', async () => {
    show(summary());
    api.assignConversation
      .mockRejectedValueOnce(stale({ assignee: bob, state_version: 4 }, {}))
      .mockRejectedValueOnce(
        new ApiError(400, 'ASSIGNEE_NOT_ACTIVE', 'x', { field: 'assignee_account_id' }),
      );
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Unassigned/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Me \(Ana/ }));
    await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Assign to Ana Shevchenko' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(
      await screen.findByText(
        'A conversation can be assigned only to an active member of this workspace.',
      ),
    ).toBeInTheDocument();
  });

  it('change limit on the go-ahead: the dialog closes and the bar counts down', async () => {
    show(summary({ status: 'closed' }));
    api.reopenConversation
      .mockRejectedValueOnce(stale({ status: 'closed', assignee: bob, state_version: 4 }, {}))
      .mockRejectedValueOnce(
        new ApiError(429, 'CHANGE_LIMIT_REACHED', 'x', {
          limit: 60,
          window_seconds: 60,
          retry_at: new Date(Date.now() + 30_000).toISOString(),
        }),
      );
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reopen anyway' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByText(/Changes are limited to 60 per minute/)).toBeInTheDocument();
  });

  it('error on the go-ahead: the message stays inside the dialog, buttons enabled', async () => {
    show(summary({ status: 'closed' }));
    api.reopenConversation
      .mockRejectedValueOnce(stale({ status: 'closed', assignee: bob, state_version: 4 }, {}))
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x', undefined));
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reopen anyway' }));
    expect(
      await within(dialog()).findByText('Couldn’t save the change — try again'),
    ).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Reopen anyway' })).toBeEnabled();
  });

  it('a live change while open leaves the dialog as it was', async () => {
    show(summary({ status: 'closed' }));
    api.reopenConversation.mockRejectedValueOnce(
      stale({ status: 'closed', assignee: bob, state_version: 4 }, {}),
    );
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByRole('alertdialog');
    act(() => show(summary({ status: 'open', assignee: ana, state_version: 9 })));
    expect(
      within(dialog()).getByText('Now: assigned to Bob Petrenko · Closed'),
    ).toBeInTheDocument();
  });
});
