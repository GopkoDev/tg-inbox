import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';
import { TeammateRepliedDialog } from './TeammateRepliedDialog';

beforeEach(() => stubRadixDom());

const NOW = new Date('2026-10-18T10:10:00Z');
const show = (over: Partial<React.ComponentProps<typeof TeammateRepliedDialog>> = {}) => {
  const onKeepEditing = vi.fn();
  const onSendAnyway = vi.fn();
  render(
    <TeammateRepliedDialog
      open
      author="Olena Operator"
      positionAt="2026-10-18T10:05:00Z"
      now={NOW}
      pending={false}
      failed={false}
      onKeepEditing={onKeepEditing}
      onSendAnyway={onSendAnyway}
      {...over}
    />,
  );
  return { onKeepEditing, onSendAnyway };
};

describe('SCR-04 teammate confirmation (AC-16)', () => {
  it('default: title, who replied and how long ago, both buttons', () => {
    show();
    expect(
      screen.getByRole('alertdialog', { name: 'A teammate just replied' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Olena Operator replied to this customer 5m ago. Send your reply anyway?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeEnabled();
  });

  it('keep editing: button and Esc both call onKeepEditing', () => {
    const { onKeepEditing } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onKeepEditing).toHaveBeenCalledTimes(2);
  });

  it('send anyway calls onSendAnyway', () => {
    const { onSendAnyway } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
    expect(onSendAnyway).toHaveBeenCalledTimes(1);
  });

  it('pending: both buttons disabled, Esc ignored', () => {
    const { onKeepEditing } = show({ pending: true });
    expect(screen.getByRole('button', { name: /Send anyway/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onKeepEditing).not.toHaveBeenCalled();
  });

  it('error: the dialog stays with the message and enabled buttons', () => {
    show({ failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Your reply was not sent — try again');
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeEnabled();
  });
});
