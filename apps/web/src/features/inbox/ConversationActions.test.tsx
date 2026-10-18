import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConversationSummary } from '@tg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const api = {
  closeConversation: vi.fn(),
  reopenConversation: vi.fn(),
  assignConversation: vi.fn(),
  unassignConversation: vi.fn(),
};
vi.mock('./api-source', () => ({
  closeConversation: (...a: unknown[]) => api.closeConversation(...a),
  reopenConversation: (...a: unknown[]) => api.reopenConversation(...a),
  assignConversation: (...a: unknown[]) => api.assignConversation(...a),
  unassignConversation: (...a: unknown[]) => api.unassignConversation(...a),
}));

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
