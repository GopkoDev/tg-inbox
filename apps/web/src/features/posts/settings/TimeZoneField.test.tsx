import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';

vi.mock('../api', () => ({ setPostingTimeZone: vi.fn() }));
import { TimeZoneField } from './TimeZoneField';

stubRadixDom();

describe('TimeZoneField (AC-09)', () => {
  it('edits the zone through a Select, not a free-text input', () => {
    render(
      <TimeZoneField
        workspaceId="w"
        timeZone="Europe/Kyiv"
        scheduledTotal={0}
        canEdit
        onSaved={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Time zone' })).toBeNull();
  });
});
