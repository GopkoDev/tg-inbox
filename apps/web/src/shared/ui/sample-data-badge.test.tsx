import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SampleDataBadge } from './sample-data-badge';

describe('SampleDataBadge (AC-17)', () => {
  it('shows the fixed «Sample data» label', () => {
    render(<SampleDataBadge />);
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });
});
