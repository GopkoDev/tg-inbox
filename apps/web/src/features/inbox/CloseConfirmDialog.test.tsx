import { fireEvent, render, screen } from '@testing-library/react';
import type { CloseReason, ThreadActivity } from '@tg/shared';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';
import { CloseConfirmDialog } from './CloseConfirmDialog';

beforeEach(() => stubRadixDom());

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-18T10:10:00Z');
const bob = { account_id: id(3), display_name: 'Bob Petrenko' };
const unread = { id: id(500), received_at: '2026-10-18T10:05:00.000Z' };

const staleChange: ThreadActivity = {
  type: 'activity',
  id: id(700),
  workspace_id: id(1),
  conversation_id: id(101),
  kind: 'assigned',
  cause: 'member',
  actor: bob,
  previous_assignee: null,
  new_assignee: bob,
  position_at: '2026-10-18T10:08:00.000Z',
};

const show = (over: Partial<React.ComponentProps<typeof CloseConfirmDialog>> = {}) => {
  const onKeep = vi.fn();
  const onCloseAnyway = vi.fn();
  render(
    <CloseConfirmDialog
      open
      reasons={['customer_waiting'] as CloseReason[]}
      staleChange={null}
      newestUnreadMessage={null}
      again={false}
      pending={false}
      failed={false}
      now={NOW}
      onKeep={onKeep}
      onCloseAnyway={onCloseAnyway}
      {...over}
    />,
  );
  return { onKeep, onCloseAnyway };
};

describe('SCR-12 confirm close (AC-06, AC-08)', () => {
  it('default: title, lead-in, one line per reason, Keep it open and Close anyway', () => {
    show({
      reasons: ['customer_waiting', 'reply_not_delivered', 'reply_not_confirmed'],
    });
    expect(
      screen.getByRole('alertdialog', { name: 'Close this conversation?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('It may be too early:')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('The customer is waiting for a reply')).toBeInTheDocument();
    expect(screen.getByText('The latest reply was not delivered')).toBeInTheDocument();
    expect(
      screen.getByText('The latest reply was not confirmed — it may not have reached the customer'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it open' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close anyway' })).toBeEnabled();
  });

  it('unread and new together are one line with how long ago', () => {
    show({
      reasons: ['unread_customer_message', 'new_customer_message'],
      newestUnreadMessage: unread,
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(
      screen.getByText("A customer message arrived that you haven't read — 5 minutes ago"),
    ).toBeInTheDocument();
  });

  it('unread alone has the same line', () => {
    show({ reasons: ['unread_customer_message'], newestUnreadMessage: unread });
    expect(
      screen.getByText("A customer message arrived that you haven't read — 5 minutes ago"),
    ).toBeInTheDocument();
  });

  it('only new: «since you opened it»', () => {
    show({ reasons: ['new_customer_message'], newestUnreadMessage: unread });
    expect(
      screen.getByText("A customer message arrived that you haven't read — since you opened it"),
    ).toBeInTheDocument();
  });

  it('state changed: the stale change as in SCR-11', () => {
    show({ reasons: ['state_changed'], staleChange });
    expect(
      screen.getByText(
        'It changed since you looked: Bob Petrenko assigned this to Bob Petrenko — 2 minutes ago',
      ),
    ).toBeInTheDocument();
  });

  it('kept open: the button and Esc call onKeep; a click outside does not', () => {
    const { onKeep } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it open' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onKeep).toHaveBeenCalledTimes(2);
    onKeep.mockClear();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('Close anyway calls onCloseAnyway', () => {
    const { onCloseAnyway } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
    expect(onCloseAnyway).toHaveBeenCalledTimes(1);
  });

  it('pending: both buttons disabled with a spinner, Esc ignored', () => {
    const { onKeep } = show({ pending: true });
    expect(screen.getByRole('button', { name: 'Keep it open' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Close anyway/ })).toBeDisabled();
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('asks again: the notice sits above the buttons, which stay enabled', () => {
    show({ again: true });
    expect(
      screen.getByText('Something changed while you were deciding — check again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close anyway' })).toBeEnabled();
  });

  it('error: destructive message in the dialog, buttons enabled', () => {
    show({ failed: true });
    expect(screen.getByText('Couldn’t close the conversation — try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it open' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close anyway' })).toBeEnabled();
  });

  it('focus returns to the control that opened it', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            opener
          </button>
          <CloseConfirmDialog
            open={open}
            reasons={['customer_waiting']}
            staleChange={null}
            newestUnreadMessage={null}
            again={false}
            pending={false}
            failed={false}
            onKeep={() => setOpen(false)}
            onCloseAnyway={() => undefined}
          />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it open' }));
    expect(opener).toHaveFocus();
  });
});
