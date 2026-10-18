import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';
import { SendAgainDialog } from './SendAgainDialog';

const props = (over = {}) => ({
  open: true,
  pending: false,
  problem: null,
  onCancel: vi.fn(),
  onSendAgain: vi.fn(),
  ...over,
});

beforeEach(() => stubRadixDom());

describe('SendAgainDialog', () => {
  it('warns about the duplicate and wires both buttons', () => {
    const p = props();
    render(<SendAgainDialog {...p} />);
    expect(screen.getByText('Send this reply again?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onSendAgain).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending', () => {
    render(<SendAgainDialog {...props({ pending: true })} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send again/ })).toBeDisabled();
  });

  it('renders nothing when closed and shows problems when set', () => {
    const { rerender } = render(<SendAgainDialog {...props({ open: false })} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(<SendAgainDialog {...props({ problem: 'failed' })} />);
    expect(screen.getByText('Something went wrong — try again')).toBeInTheDocument();
  });
});
