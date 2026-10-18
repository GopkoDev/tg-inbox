import { fireEvent, render, screen } from '@testing-library/react';
import type { ConversationSummary, ThreadActivity } from '@tg/shared';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';
import { StateChangedDialog } from './StateChangedDialog';

beforeEach(() => stubRadixDom());

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-18T10:10:00Z');
const ana = { account_id: id(2), display_name: 'Ana Shevchenko' };
const bob = { account_id: id(3), display_name: 'Bob Petrenko' };

const conversation = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: id(101),
  workspace_id: id(1),
  contact: { id: id(900), first_name: 'Ada', last_name: null, username: null },
  last_activity_at: '2026-10-18T10:05:00.000Z',
  last_item: { type: 'message', id: id(500), kind: 'text', body: 'hi' },
  unread_count: 0,
  waiting_for_reply: false,
  status: 'open',
  assignee: bob,
  state_version: 5,
  close_snapshot: { customer_message_seq: 1, latest_reply: null },
  ...over,
});

const change = (over: Partial<ThreadActivity> = {}): ThreadActivity => ({
  type: 'activity',
  id: id(700),
  workspace_id: id(1),
  conversation_id: id(101),
  kind: 'reassigned',
  cause: 'member',
  actor: bob,
  previous_assignee: ana,
  new_assignee: bob,
  position_at: '2026-10-18T10:08:00.000Z',
  ...over,
});

const show = (over: Partial<React.ComponentProps<typeof StateChangedDialog>> = {}) => {
  const onLeave = vi.fn();
  const onGoAhead = vi.fn();
  render(
    <StateChangedDialog
      open
      action="assign"
      pickName="Olena Operator"
      conversation={conversation()}
      latestChange={change()}
      again={false}
      pending={false}
      failed={false}
      now={NOW}
      onLeave={onLeave}
      onGoAhead={onGoAhead}
      {...over}
    />,
  );
  return { onLeave, onGoAhead };
};

describe('SCR-11 confirm over a recent change (AC-03)', () => {
  it('assign: current state, the member change with its age, Leave it and Assign to the pick', () => {
    show();
    expect(
      screen.getByRole('alertdialog', { name: 'This conversation changed since you looked' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Now: assigned to Bob Petrenko · Open')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bob Petrenko reassigned this from Ana Shevchenko to Bob Petrenko — 2 minutes ago',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave it' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Assign to Olena Operator' })).toBeEnabled();
  });

  it('unassign: «Unassign anyway», unassigned and closed state', () => {
    show({
      action: 'unassign',
      pickName: null,
      conversation: conversation({ assignee: null, status: 'closed' }),
      latestChange: change({
        kind: 'unassigned',
        previous_assignee: bob,
        new_assignee: null,
      }),
    });
    expect(screen.getByText('Now: unassigned · Closed')).toBeInTheDocument();
    expect(screen.getByText('Bob Petrenko unassigned this — 2 minutes ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unassign anyway' })).toBeInTheDocument();
  });

  it('reopen: «Reopen anyway»; an automatic reopening by cause', () => {
    show({
      action: 'reopen',
      pickName: null,
      latestChange: change({
        kind: 'reopened',
        cause: 'customer_wrote',
        actor: null,
        previous_assignee: null,
        new_assignee: null,
        position_at: '2026-10-18T10:09:00.000Z',
      }),
    });
    expect(screen.getByText('Reopened — the customer wrote — 1 minute ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen anyway' })).toBeInTheDocument();
  });

  it('automatic changes: undelivered reply and deactivation read by cause', () => {
    show({
      latestChange: change({
        kind: 'reopened',
        cause: 'reply_not_delivered',
        actor: null,
        previous_assignee: null,
        new_assignee: null,
      }),
    });
    expect(
      screen.getByText('Reopened — a reply was not delivered — 2 minutes ago'),
    ).toBeInTheDocument();
  });

  it('deactivation: «Unassigned — Bob Petrenko was deactivated»', () => {
    show({
      latestChange: change({
        kind: 'unassigned',
        cause: 'member_deactivated',
        actor: null,
        previous_assignee: bob,
        new_assignee: null,
      }),
    });
    expect(
      screen.getByText('Unassigned — Bob Petrenko was deactivated — 2 minutes ago'),
    ).toBeInTheDocument();
  });

  it('no latest change: only the «Now» line', () => {
    show({ latestChange: null });
    expect(screen.getByText('Now: assigned to Bob Petrenko · Open')).toBeInTheDocument();
    expect(screen.queryByTestId('latest-change')).not.toBeInTheDocument();
  });

  it('left it: the button and Esc call onLeave; a click outside does not', () => {
    const { onLeave } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Leave it' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(2);
    onLeave.mockClear();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('go ahead calls onGoAhead', () => {
    const { onGoAhead } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Assign to Olena Operator' }));
    expect(onGoAhead).toHaveBeenCalledTimes(1);
  });

  it('pending: both buttons disabled with a spinner, Esc ignored', () => {
    const { onLeave } = show({ pending: true });
    expect(screen.getByRole('button', { name: 'Leave it' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Assign to Olena Operator/ })).toBeDisabled();
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('asks again: the notice sits above the buttons, which stay enabled', () => {
    show({ again: true });
    expect(screen.getByText('It changed again — check before going ahead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave it' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Assign to Olena Operator' })).toBeEnabled();
  });

  it('error: «Couldn’t save the change — try again» in the dialog, buttons enabled', () => {
    show({ failed: true });
    expect(screen.getByText('Couldn’t save the change — try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign to Olena Operator' })).toBeEnabled();
  });

  it('focus returns to the control that opened it', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            opener
          </button>
          <StateChangedDialog
            open={open}
            action="reopen"
            pickName={null}
            conversation={conversation()}
            latestChange={null}
            again={false}
            pending={false}
            failed={false}
            onLeave={() => setOpen(false)}
            onGoAhead={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Leave it' }));
    expect(opener).toHaveFocus();
  });
});
