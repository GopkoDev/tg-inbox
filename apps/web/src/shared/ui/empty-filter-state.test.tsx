import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyFilterState } from './empty-filter-state';

describe('EmptyFilterState', () => {
  it('shows the message and a Clear filters button that calls onClear', () => {
    const onClear = vi.fn();
    render(<EmptyFilterState message="No contacts match your filters." onClear={onClear} />);
    expect(screen.getByText('No contacts match your filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
