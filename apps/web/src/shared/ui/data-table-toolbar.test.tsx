import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTableToolbar } from './data-table-toolbar';

// API: <DataTableToolbar search={ReactNode} filters={ReactNode} /> — both optional slots.
describe('DataTableToolbar', () => {
  it('renders the search slot and the filter slots', () => {
    render(
      <DataTableToolbar
        search={<input aria-label="Search contacts" />}
        filters={
          <>
            <button type="button">Status</button>
            <button type="button">Role</button>
          </>
        }
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Search contacts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Role' })).toBeInTheDocument();
  });

  it('renders with only a search slot', () => {
    render(<DataTableToolbar search={<input aria-label="Search" />} />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
  });
});
