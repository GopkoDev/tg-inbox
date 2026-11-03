import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TagWithCount } from '@tg/shared';
import { stubRadixDom } from '@/test/radix';
import type { TagsStatus } from '@/features/tags/store';
import type { ContactsAddress } from './address';
import { TagFilter } from './TagFilter';

stubRadixDom();

const tag = (n: number, name: string, count: number): TagWithCount => ({
  id: `0198f0c0-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`,
  name,
  contact_count: count,
});
const TAGS = [tag(1, 'Kyiv', 30), tag(2, 'VIP', 14), tag(3, 'Wholesale', 0)];

function Harness({
  initial,
  tags = TAGS,
  status = 'ready',
  onRetry = () => undefined,
  onChange,
}: {
  initial: Pick<ContactsAddress, 'mode' | 'tagIds'>;
  tags?: TagWithCount[];
  status?: TagsStatus;
  onRetry?: () => void;
  onChange?: (v: Pick<ContactsAddress, 'mode' | 'tagIds'>) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TagFilter
      tags={tags}
      status={status}
      onRetry={onRetry}
      mode={value.mode}
      tagIds={value.tagIds}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}
const open = () => fireEvent.click(screen.getByRole('button', { name: /^(Tags|All of|No tags)/ }));

describe('TagFilter button label', () => {
  it.each([
    [{ mode: 'any', tagIds: [] }, 'Tags'],
    [{ mode: 'any', tagIds: [TAGS[0]!.id, TAGS[1]!.id] }, 'Tags · 2'],
    [{ mode: 'all', tagIds: [TAGS[0]!.id, TAGS[1]!.id] }, 'All of 2 tags'],
    [{ mode: 'all', tagIds: [TAGS[0]!.id] }, 'All of 1 tag'],
    [{ mode: 'all', tagIds: [] }, 'Tags'],
    [{ mode: 'none', tagIds: [] }, 'No tags'],
  ] as const)('reads %j as «%s»', (initial, label) => {
    render(<Harness initial={{ mode: initial.mode, tagIds: [...initial.tagIds] }} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });
});

describe('TagFilter popover', () => {
  it('offers the three modes and one checkbox per tag with its count, in tag-list order', () => {
    render(<Harness initial={{ mode: 'any', tagIds: [] }} />);
    open();
    expect(screen.getByRole('radio', { name: 'Any of these tags' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All of these tags' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'No tags' })).not.toBeChecked();
    const boxes = screen.getAllByRole('checkbox');
    expect(
      boxes.map((b) => b.getAttribute('aria-label') ?? b.closest('label')?.textContent),
    ).toEqual(['Kyiv30', 'VIP14', 'Wholesale0']);
  });

  it('checks and unchecks tags, reporting the ids in the order chosen', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: 'any', tagIds: [] }} onChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: /VIP/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Kyiv/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'any', tagIds: [TAGS[1]!.id, TAGS[0]!.id] });
    fireEvent.click(screen.getByRole('checkbox', { name: /VIP/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'any', tagIds: [TAGS[0]!.id] });
  });

  it('switches between any of and all of keeping the chosen tags', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: 'any', tagIds: [TAGS[0]!.id] }} onChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'All of these tags' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all', tagIds: [TAGS[0]!.id] });
  });

  it('No tags clears the chosen tags and disables the checkboxes', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: 'any', tagIds: [TAGS[0]!.id] }} onChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'No tags' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'none', tagIds: [] });
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'No tags' })).toBeChecked();
  });

  it('checking a tag while No tags is chosen switches to any of', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: 'none', tagIds: [] }} onChange={onChange} />);
    open();
    // disabled checkboxes cannot be checked: the mode changes first, then the tag can be
    fireEvent.click(screen.getByRole('radio', { name: 'Any of these tags' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'any', tagIds: [] });
    fireEvent.click(screen.getByRole('checkbox', { name: /Kyiv/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'any', tagIds: [TAGS[0]!.id] });
  });

  it('a workspace with no tags says so and offers only No tags', () => {
    render(<Harness initial={{ mode: 'any', tagIds: [] }} tags={[]} />);
    open();
    expect(screen.getByText('No tags yet — tags are added on a contact')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Any of these tags' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'All of these tags' })).not.toBeInTheDocument();
    const dialog = screen
      .getByRole('radio', { name: 'No tags' })
      .closest('[data-slot="popover-content"]')!;
    expect(
      within(dialog as HTMLElement).getByRole('radio', { name: 'No tags' }),
    ).toBeInTheDocument();
  });

  it('while the tags load: row skeletons, not «No tags yet», and every mode', () => {
    render(<Harness initial={{ mode: 'any', tagIds: [] }} tags={[]} status="loading" />);
    open();
    expect(screen.getAllByTestId('tag-filter-skeleton')).toHaveLength(3);
    expect(screen.queryByText('No tags yet — tags are added on a contact')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Any of these tags' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All of these tags' })).toBeInTheDocument();
  });

  it("when the tags fail to load: «Couldn't load the tags» with Retry, not «No tags yet»", () => {
    const onRetry = vi.fn();
    render(
      <Harness initial={{ mode: 'any', tagIds: [] }} tags={[]} status="error" onRetry={onRetry} />,
    );
    open();
    expect(screen.getByText("Couldn't load the tags")).toBeInTheDocument();
    expect(screen.queryByText('No tags yet — tags are added on a contact')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('an address with mode all and a workspace with no tags: the chosen mode is shown and can be changed', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: 'all', tagIds: [] }} tags={[]} onChange={onChange} />);
    open();
    expect(screen.getByRole('radio', { name: 'All of these tags' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'No tags' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'none', tagIds: [] });
  });

  it('checks only the chosen tags', () => {
    render(<Harness initial={{ mode: 'any', tagIds: [TAGS[1]!.id] }} />);
    open();
    expect(screen.getByRole('checkbox', { name: /VIP/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Kyiv/ })).not.toBeChecked();
  });
});

describe('TagFilter driven by a draft (controlled, SCR-25 Send to)', () => {
  it.each([
    [{ mode: 'any', tagIds: [] }, 'Send to'],
    [{ mode: 'any', tagIds: [TAGS[1]!.id] }, 'Send to · Any of 1'],
    [{ mode: 'all', tagIds: [TAGS[0]!.id, TAGS[1]!.id] }, 'Send to · All of 2'],
    [{ mode: 'none', tagIds: [] }, 'Send to · No tags'],
  ] as const)('with a label reads %j as «%s»', (value, label) => {
    render(
      <TagFilter
        tags={TAGS}
        status="ready"
        onRetry={() => undefined}
        mode={value.mode}
        tagIds={[...value.tagIds]}
        onChange={() => undefined}
        label="Send to"
      />,
    );
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('disables the tags it is told to (left out elsewhere), and only those', () => {
    const onChange = vi.fn();
    render(
      <TagFilter
        tags={TAGS}
        status="ready"
        onRetry={() => undefined}
        mode="any"
        tagIds={[]}
        onChange={onChange}
        label="Send to"
        disabledTagIds={[TAGS[2]!.id]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to' }));
    expect(screen.getByRole('checkbox', { name: /Wholesale/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /VIP/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /VIP/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'any', tagIds: [TAGS[1]!.id] });
  });
});
