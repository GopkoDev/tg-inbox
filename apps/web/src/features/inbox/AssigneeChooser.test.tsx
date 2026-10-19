import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ConversationSummary } from '@tg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const api = {
  listActiveMembers: vi.fn(),
  assignConversation: vi.fn(),
  unassignConversation: vi.fn(),
  closeConversation: vi.fn(),
  reopenConversation: vi.fn(),
};
vi.mock('./api-source', () => ({
  listActiveMembers: (...a: unknown[]) => api.listActiveMembers(...a),
  assignConversation: (...a: unknown[]) => api.assignConversation(...a),
  unassignConversation: (...a: unknown[]) => api.unassignConversation(...a),
  closeConversation: (...a: unknown[]) => api.closeConversation(...a),
  reopenConversation: (...a: unknown[]) => api.reopenConversation(...a),
}));

const shared = vi.hoisted(() => ({ initials: vi.fn<(name: string) => string>() }));
vi.mock('@/shared/lib/initials', async (load) => {
  const real = await load<typeof import('@/shared/lib/initials')>();
  return {
    initials: (name: string) => {
      shared.initials(name);
      return real.initials(name);
    },
  };
});

import { useAuthStore } from '@/features/auth/store';
import { ConversationActions } from './ConversationActions';
import { useInboxStore } from './store';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WS = id(1);
const CONV = id(101);
const ana = { account_id: id(2), display_name: 'Ana Shevchenko' };
const bob = { account_id: id(3), display_name: 'Bob Petrenko' };
const oksana = { account_id: id(4), display_name: 'Oksana Kovalenko' };
const members = (...items: (typeof ana)[]) => ({ workspace_id: WS, items });

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

function show(s: ConversationSummary) {
  useInboxStore.setState({
    workspaceId: WS,
    thread: {
      conversationId: CONV,
      status: 'ready',
      contact: s.contact,
      summary: s,
      older: 'idle',
      items: [],
      hasPrev: false,
      prevCursor: null,
      readThroughAt: null,
    },
  });
}
const change = (over: Partial<ConversationSummary>, outcome = 'recorded') => ({
  workspace_id: WS,
  outcome,
  conversation: summary(over),
  activity: null,
});
const renderBar = (props = {}) =>
  render(<ConversationActions workspaceId={WS} conversationId={CONV} {...props} />);
const openChooser = (name: RegExp = /Unassigned/) =>
  fireEvent.click(screen.getByRole('button', { name }));
const dialog = () => screen.getByRole('dialog');
const row = (name: RegExp) => within(dialog()).getByRole('button', { name });

beforeEach(() => {
  vi.resetAllMocks();
  useInboxStore.getState().leave();
  useAuthStore
    .getState()
    .setAccount({ id: ana.account_id, email: 'a@x.io', display_name: 'Ana Shevchenko' });
  api.listActiveMembers.mockResolvedValue(members(ana, bob, oksana));
});
afterEach(() => vi.useRealTimers());

describe('SCR-10 assignee chooser', () => {
  it('loading: opens under the button, reads the members and shows 3 skeleton rows', async () => {
    show(summary());
    let finish: (v: unknown) => void = () => {};
    api.listActiveMembers.mockReturnValue(new Promise((r) => (finish = r)));
    renderBar();
    openChooser();
    expect(await screen.findByText('Assign to')).toBeInTheDocument();
    expect(within(dialog()).getAllByTestId('member-skeleton')).toHaveLength(3);
    expect(api.listActiveMembers).toHaveBeenCalledWith(WS);
    await act(async () => finish(members(ana, bob)));
    expect(within(dialog()).queryByTestId('member-skeleton')).toBeNull();
  });

  it('default: Me first, then the others in the answer order, Unassign only when assigned', async () => {
    show(summary({ assignee: bob }));
    api.listActiveMembers.mockResolvedValue(members(bob, ana, oksana));
    renderBar();
    openChooser(/Bob Petrenko/);
    await screen.findByRole('button', { name: /Me \(Ana Shevchenko\)/ });
    const names = within(dialog())
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names[0]).toContain('Me (Ana Shevchenko)');
    expect(names[1]).toContain('Bob Petrenko');
    expect(names[2]).toContain('Oksana Kovalenko');
    expect(names[3]).toContain('Unassign');
    expect(row(/Bob Petrenko/)).toHaveAttribute('aria-current', 'true');
    expect(row(/Me \(/)).not.toHaveAttribute('aria-current');
    expect(within(row(/Bob Petrenko/)).getByTestId('current-check')).toBeInTheDocument();
    expect(within(dialog()).getByText('BP')).toBeInTheDocument();
  });

  it('unassigned: no Unassign row', async () => {
    show(summary());
    renderBar();
    openChooser();
    await screen.findByRole('button', { name: /Me \(/ });
    expect(within(dialog()).queryByRole('button', { name: 'Unassign' })).toBeNull();
  });

  it('only me: just Me (and Unassign when assigned)', async () => {
    show(summary({ assignee: ana }));
    api.listActiveMembers.mockResolvedValue(members(ana));
    renderBar();
    openChooser(/Ana Shevchenko/);
    await screen.findByRole('button', { name: /Me \(/ });
    const names = within(dialog())
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toHaveLength(2);
    expect(names[0]).toContain('Me (Ana Shevchenko)');
    expect(names[1]).toContain('Unassign');
  });

  it('pick the current assignee: closes, sends nothing', async () => {
    show(summary({ assignee: bob }));
    const onResult = vi.fn();
    renderBar({ onResult });
    openChooser(/Bob Petrenko/);
    await screen.findByRole('button', { name: /Me \(/ });
    fireEvent.click(row(/Bob Petrenko/));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.assignConversation).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('pending: the row spins, the others and the bar are disabled', async () => {
    show(summary());
    let finish: (v: unknown) => void = () => {};
    api.assignConversation.mockReturnValue(new Promise((r) => (finish = r)));
    renderBar();
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: /Bob Petrenko/ }));
    await waitFor(() =>
      expect(within(row(/Bob Petrenko/)).getByTestId('row-spinner')).toBeInTheDocument(),
    );
    expect(row(/Me \(/)).toBeDisabled();
    expect(row(/Oksana/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(api.assignConversation).toHaveBeenCalledWith(
      WS,
      CONV,
      { assignee_account_id: bob.account_id, expected_state_version: 3 },
      expect.anything(),
    );
    await act(async () => finish(change({ assignee: bob, state_version: 4 })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('success: closes, the bar shows the new assignee and reports the result', async () => {
    show(summary());
    api.assignConversation.mockResolvedValue(change({ assignee: ana, state_version: 4 }));
    const onResult = vi.fn();
    renderBar({ onResult });
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: /Me \(/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /Ana Shevchenko/ })).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(
      'assign',
      expect.objectContaining({ kind: 'recorded' }),
      ana.account_id,
    );
  });

  it('unassign sends the unassign call with the version on screen', async () => {
    show(summary({ assignee: bob, state_version: 7 }));
    api.unassignConversation.mockResolvedValue(change({ assignee: null, state_version: 8 }));
    renderBar();
    openChooser(/Bob Petrenko/);
    fireEvent.click(await screen.findByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.unassignConversation).toHaveBeenCalledWith(
      WS,
      CONV,
      { expected_state_version: 7 },
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeInTheDocument();
  });

  it('refused not active: stays open with the alert, re-reads the members without the gone one', async () => {
    show(summary());
    api.listActiveMembers
      .mockResolvedValueOnce(members(ana, bob, oksana))
      .mockResolvedValueOnce(members(ana, oksana));
    api.assignConversation.mockRejectedValue(
      new ApiError(400, 'ASSIGNEE_NOT_ACTIVE', 'x', { field: 'assignee_account_id' }),
    );
    renderBar();
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: /Bob Petrenko/ }));
    expect(
      await screen.findByText(
        'A conversation can be assigned only to an active member of this workspace.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.listActiveMembers).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(dialog()).queryByRole('button', { name: /Bob Petrenko/ })).toBeNull(),
    );
    expect(row(/Oksana/)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('changed since I looked: closes and hands the pick to the owner', async () => {
    show(summary());
    api.assignConversation.mockRejectedValue(
      new ApiError(409, 'CONVERSATION_STATE_CHANGED', 'x', {
        conversation: summary({ assignee: oksana, state_version: 4 }),
        latest_change: null,
      }),
    );
    const onResult = vi.fn();
    renderBar({ onResult });
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: /Bob Petrenko/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onResult).toHaveBeenCalledWith(
      'assign',
      expect.objectContaining({ kind: 'stale' }),
      bob.account_id,
    );
  });

  it('change limit closes the chooser and the bar counts down', async () => {
    show(summary());
    api.assignConversation.mockRejectedValue(
      new ApiError(429, 'CHANGE_LIMIT_REACHED', 'x', {
        limit: 60,
        window_seconds: 60,
        retry_at: new Date(Date.now() + 30_000).toISOString(),
      }),
    );
    renderBar();
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: /Bob Petrenko/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Changes are limited to 60 per minute/)).toBeInTheDocument();
  });

  it('change failed closes the chooser and the bar says so', async () => {
    show(summary());
    api.assignConversation.mockRejectedValue(new Error('network'));
    renderBar();
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: /Bob Petrenko/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Couldn't save the change/)).toBeInTheDocument();
  });

  it('members not loaded: message with Retry that reads again', async () => {
    show(summary());
    api.listActiveMembers
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(members(ana, bob));
    renderBar();
    openChooser();
    expect(await screen.findByText("Couldn't load the team")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Bob Petrenko/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the team")).toBeNull();
  });

  it('reads the members every time it opens', async () => {
    show(summary());
    renderBar();
    openChooser();
    await screen.findByRole('button', { name: /Bob Petrenko/ });
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    openChooser();
    await screen.findByRole('button', { name: /Bob Petrenko/ });
    expect(api.listActiveMembers).toHaveBeenCalledTimes(2);
  });

  it('keyboard: arrows move between rows, Esc closes and focus returns to the button', async () => {
    show(summary({ assignee: bob }));
    renderBar();
    const trigger = screen.getByRole('button', { name: /Bob Petrenko/ });
    fireEvent.click(trigger);
    const me = await screen.findByRole('button', { name: /Me \(/ });
    await waitFor(() => expect(me).toHaveFocus());
    fireEvent.keyDown(me, { key: 'ArrowDown' });
    expect(row(/Bob Petrenko/)).toHaveFocus();
    fireEvent.keyDown(row(/Bob Petrenko/), { key: 'ArrowDown' });
    fireEvent.keyDown(row(/Oksana/), { key: 'ArrowDown' });
    expect(row(/Unassign/)).toHaveFocus();
    fireEvent.keyDown(row(/Unassign/), { key: 'ArrowDown' });
    expect(row(/Me \(/)).toHaveFocus();
    fireEvent.keyDown(row(/Me \(/), { key: 'ArrowUp' });
    expect(row(/Unassign/)).toHaveFocus();
    fireEvent.keyDown(row(/Unassign/), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('phone: the popover follows the trigger width with a 240px minimum and scrolls', async () => {
    show(summary());
    renderBar({ compact: true });
    openChooser();
    await screen.findByRole('button', { name: /Me \(/ });
    const cls = dialog().className;
    expect(cls).toContain('w-(--radix-popover-trigger-width)');
    expect(cls).toContain('min-w-60');
    expect(within(dialog()).getByTestId('member-list').className).toContain('overflow-y-auto');
  });
});

describe('SCR-10 avatars (W9)', () => {
  it('uses the shared initials helper for every member row', async () => {
    show(summary());
    renderBar();
    openChooser();
    await within(dialog()).findByRole('button', { name: /Bob Petrenko/ });
    expect(shared.initials).toHaveBeenCalledWith('Bob Petrenko');
    expect(within(row(/Bob Petrenko/)).getByText('BP')).toBeInTheDocument();
  });
});
