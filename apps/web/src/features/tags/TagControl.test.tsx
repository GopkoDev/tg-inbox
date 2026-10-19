import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ErrorCode, type ContactProfile, type ContactTag, type TagWithCount } from '@tg/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  getContact: vi.fn(),
  addContactTag: vi.fn(),
  removeContactTag: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listTags: (...a: unknown[]) => api.listTags(...a),
}));
vi.mock('@/features/contacts/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/contacts/api')>()),
  getContact: (...a: unknown[]) => api.getContact(...a),
  addContactTag: (...a: unknown[]) => api.addContactTag(...a),
  removeContactTag: (...a: unknown[]) => api.removeContactTag(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: () => () => undefined,
}));

import { useContactsStore } from '@/features/contacts/store';
import { TagControl } from './TagControl';
import { useTagsStore } from './store';

stubRadixDom();

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WS = id(1);
const C1 = id(901);
const me = { account_id: id(800), display_name: 'Test User' };
const workspaceTag = (n: number, name: string, count = 1): TagWithCount => ({
  id: id(300 + n),
  name,
  contact_count: count,
});
const KYIV = workspaceTag(1, 'Kyiv');
const KYIV_VIP = workspaceTag(2, 'Kyiv VIP clients');
const VINTAGE = workspaceTag(3, 'Vintage');
const VIP = workspaceTag(4, 'VIP');
const WHOLESALE = workspaceTag(5, 'Wholesale');
const ALL = [KYIV, KYIV_VIP, VINTAGE, VIP, WHOLESALE];
const carried = (t: { id: string; name: string }): ContactTag => ({
  id: t.id,
  name: t.name,
  added_by: me,
  added_at: '2026-10-19T10:02:00Z',
});
const contact = (tags: ContactTag[]): ContactProfile => ({
  id: C1,
  workspace_id: WS,
  first_name: 'Ada',
  last_name: null,
  username: null,
  language_code: null,
  first_wrote_at: null,
  last_wrote_at: null,
  tags,
});
const added = (
  tag: { id: string; name: string },
  tags: ContactTag[],
  over: { outcome?: 'recorded' | 'unchanged'; tag_created?: boolean } = {},
) => ({
  workspace_id: WS,
  contact_id: C1,
  outcome: over.outcome ?? 'recorded',
  tag: { id: tag.id, name: tag.name },
  tag_created: over.tag_created ?? false,
  tags,
});
const removed = (tags: ContactTag[], outcome: 'recorded' | 'unchanged' = 'recorded') => ({
  workspace_id: WS,
  contact_id: C1,
  outcome,
  tags,
});
const refusal = (status: number, code: ErrorCode, details?: unknown) =>
  new ApiError(status, code, code, details);
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => Promise.resolve());
};

/** The host: the inbox header's slice of the contacts store (applyTags updates it). */
function Host({ source = 'inbox' as const }: { source?: 'inbox' | 'profile' }) {
  const header = useContactsStore((s) => s.header);
  return (
    <TagControl
      workspaceId={WS}
      contactId={C1}
      tags={header?.contact?.tags ?? []}
      source={source}
    />
  );
}

function renderControl(tags: ContactTag[], source: 'inbox' | 'profile' = 'inbox') {
  useContactsStore.setState({
    workspaceId: WS,
    header: { contactId: C1, status: 'ready', contact: contact(tags) },
  });
  return render(
    <MemoryRouter>
      <Host source={source} />
    </MemoryRouter>,
  );
}
const trigger = () => screen.getByRole('button', { name: 'Add tag' });
const popover = () => screen.getByRole('dialog');
const input = () => within(popover()).getByRole('combobox');
const option = (name: RegExp | string) => within(popover()).getByRole('option', { name });
const optionNames = () =>
  within(popover())
    .queryAllByRole('option')
    .map((o) => o.textContent);
async function openControl() {
  fireEvent.click(trigger());
  await flush();
}
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

const GUIDANCE =
  "Tags are visible to your whole team. Don't use them for health, religion or other sensitive traits.";

beforeEach(() => {
  vi.resetAllMocks();
  useTagsStore.getState().clear();
  useContactsStore.getState().clear();
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  api.listTags.mockResolvedValue({ workspace_id: WS, items: ALL });
  api.getContact.mockResolvedValue(contact([]));
});
afterEach(() => vi.useRealTimers());

describe('SCR-20 default', () => {
  it('opens with focus in the search, the carried badges, every tag in order and the guidance line', async () => {
    renderControl([carried(KYIV), carried(VIP)]);
    await openControl();
    expect(input()).toHaveFocus();
    expect(input()).toHaveAttribute('placeholder', 'Add a tag…');
    expect(input()).toHaveAttribute('aria-controls', within(popover()).getByRole('listbox').id);
    const kyiv = within(popover()).getByText('Kyiv', { selector: '[data-slot="badge"] span' });
    expect(kyiv.closest('[data-slot="badge"]')).toHaveAttribute(
      'title',
      expect.stringContaining('Added by Test User'),
    );
    expect(within(popover()).getByRole('button', { name: 'Remove tag Kyiv' })).toBeEnabled();
    expect(within(popover()).getByRole('button', { name: 'Remove tag VIP' })).toBeEnabled();
    expect(optionNames()).toEqual([
      'Kyiv✓ On this contact',
      'Kyiv VIP clients',
      'Vintage',
      'VIP✓ On this contact',
      'Wholesale',
    ]);
    expect(option(/^Kyiv✓/)).toBeDisabled();
    expect(option('Vintage')).toBeEnabled();
    expect(within(popover()).getByText(GUIDANCE)).toBeInTheDocument();
    expect(api.listTags).toHaveBeenCalledWith(WS, {});
  });

  it('typing: starts-with matches before contains, the create row last', async () => {
    renderControl([]);
    await openControl();
    type('vi');
    expect(optionNames()).toEqual(['Vintage', 'VIP', 'Kyiv VIP clients', 'Create tag "vi"']);
    expect(within(popover()).getByText(GUIDANCE)).toBeInTheDocument();
  });

  it.each(['vip', ' VIP ', 'VIP  '])('typing «%s»: only VIP, no create row', async (text) => {
    renderControl([]);
    await openControl();
    type(text);
    expect(optionNames()).toEqual(['VIP']);
  });

  it('typing a new name: the tidied text in the create row', async () => {
    renderControl([]);
    await openControl();
    type('  New   York ');
    expect(optionNames()).toEqual(['Create tag "New York"']);
  });

  it('empty: a workspace with no tags says how to create the first', async () => {
    api.listTags.mockResolvedValue({ workspace_id: WS, items: [] });
    renderControl([]);
    await openControl();
    expect(within(popover()).getByText('Type a name to create the first tag')).toBeInTheDocument();
    expect(within(popover()).getByText(GUIDANCE)).toBeInTheDocument();
  });

  it('loading: 3 row skeletons while listTags is in flight; carried badges at once', async () => {
    let finish: (v: unknown) => void = () => {};
    api.listTags.mockReturnValue(new Promise((r) => (finish = r)));
    renderControl([carried(VIP)]);
    await openControl();
    expect(within(popover()).getAllByTestId('tag-skeleton')).toHaveLength(3);
    expect(within(popover()).getByRole('button', { name: 'Remove tag VIP' })).toBeInTheDocument();
    await act(async () => finish({ workspace_id: WS, items: ALL }));
    expect(within(popover()).queryByTestId('tag-skeleton')).toBeNull();
    expect(optionNames()).toHaveLength(5);
  });
});

describe('SCR-20 adding and removing (AC-06)', () => {
  it('picks a suggestion: sends its id and the source, moves it into the badges, clears and keeps focus', async () => {
    api.addContactTag.mockResolvedValue(added(VIP, [carried(VIP)]));
    renderControl([], 'profile');
    await openControl();
    type('vi');
    fireEvent.click(option('VIP'));
    await flush();
    expect(api.addContactTag).toHaveBeenCalledWith(WS, C1, { tag_id: VIP.id, source: 'profile' });
    expect(within(popover()).getByRole('button', { name: 'Remove tag VIP' })).toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(input()).toHaveFocus();
    expect(useContactsStore.getState().header?.contact?.tags.map((t) => t.name)).toEqual(['VIP']);
    expect(api.listTags).toHaveBeenCalledTimes(1);
  });

  it('shows a tag renamed meanwhile under the name the answer carries', async () => {
    api.addContactTag.mockResolvedValue(
      added({ id: VIP.id, name: 'VIP gold' }, [carried({ id: VIP.id, name: 'VIP gold' })]),
    );
    renderControl([]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    expect(
      within(popover()).getByRole('button', { name: 'Remove tag VIP gold' }),
    ).toBeInTheDocument();
  });

  it('creates a tag: sends the tidied name, the tag store re-reads listTags', async () => {
    const created = { id: id(399), name: 'Kyiv region' };
    api.addContactTag.mockResolvedValue(added(created, [carried(created)], { tag_created: true }));
    renderControl([]);
    await openControl();
    type(' Kyiv   region ');
    fireEvent.click(option('Create tag "Kyiv region"'));
    await flush();
    expect(api.addContactTag).toHaveBeenCalledWith(WS, C1, {
      name: 'Kyiv region',
      source: 'inbox',
    });
    expect(api.listTags).toHaveBeenCalledTimes(2);
    expect(api.listTags).toHaveBeenLastCalledWith(WS, { background: true });
    expect(
      within(popover()).getByRole('button', { name: 'Remove tag Kyiv region' }),
    ).toBeInTheDocument();
  });

  it('removes a tag: sends the source, the badge goes, the control stays open', async () => {
    api.removeContactTag.mockResolvedValue(removed([carried(VIP)]));
    renderControl([carried(VIP), carried(WHOLESALE)]);
    await openControl();
    fireEvent.click(within(popover()).getByRole('button', { name: 'Remove tag Wholesale' }));
    await flush();
    expect(api.removeContactTag).toHaveBeenCalledWith(WS, C1, WHOLESALE.id, { source: 'inbox' });
    expect(within(popover()).queryByRole('button', { name: 'Remove tag Wholesale' })).toBeNull();
    expect(popover()).toBeInTheDocument();
  });

  it('unchanged: shows the answer tags with no message', async () => {
    api.addContactTag.mockResolvedValue(
      added(VIP, [carried(VIP), carried(KYIV)], { outcome: 'unchanged' }),
    );
    renderControl([]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    expect(within(popover()).getByRole('button', { name: 'Remove tag Kyiv' })).toBeInTheDocument();
    expect(within(popover()).queryByRole('alert')).toBeNull();
  });

  it('pending: a spinner on the row, every add / remove disabled, the input stays editable', async () => {
    let finish: (v: unknown) => void = () => {};
    api.addContactTag.mockReturnValue(new Promise((r) => (finish = r)));
    renderControl([carried(KYIV)]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    expect(within(option('VIP')).getByTestId('row-spinner')).toBeInTheDocument();
    expect(option('Vintage')).toBeDisabled();
    expect(within(popover()).getByRole('button', { name: 'Remove tag Kyiv' })).toBeDisabled();
    expect(input()).toBeEnabled();
    await act(async () => finish(added(VIP, [carried(KYIV), carried(VIP)])));
    expect(option('Vintage')).toBeEnabled();
  });
});

describe('SCR-20 name rules (AC-07)', () => {
  it('a name of 33 characters is refused in place and nothing is sent', async () => {
    renderControl([]);
    await openControl();
    type('x'.repeat(33));
    fireEvent.click(option(/^Create tag/));
    expect(
      within(popover()).getByText('A tag name must be 1 to 32 characters'),
    ).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(api.addContactTag).not.toHaveBeenCalled();
  });

  it('Enter on text that tidies to nothing is refused in place', async () => {
    renderControl([]);
    await openControl();
    type('   ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(
      within(popover()).getByText('A tag name must be 1 to 32 characters'),
    ).toBeInTheDocument();
    expect(api.addContactTag).not.toHaveBeenCalled();
  });

  it('an emoji counts as one character', async () => {
    api.addContactTag.mockResolvedValue(added({ id: id(398), name: 'x' }, [], {}));
    renderControl([]);
    await openControl();
    const name = 'a'.repeat(31) + '🌸';
    type(name);
    fireEvent.click(option(/^Create tag/));
    await flush();
    expect(api.addContactTag).toHaveBeenCalledWith(WS, C1, { name, source: 'inbox' });
  });

  it('a server TAG_NAME_INVALID shows the same text', async () => {
    api.addContactTag.mockRejectedValue(refusal(400, ErrorCode.TAG_NAME_INVALID));
    renderControl([]);
    await openControl();
    type('Kyiv region');
    fireEvent.click(option(/^Create tag/));
    await flush();
    expect(
      within(popover()).getByText('A tag name must be 1 to 32 characters'),
    ).toBeInTheDocument();
  });
});

describe('SCR-20 limits and refusals (AC-08, AC-14, AC-15)', () => {
  const twenty = Array.from({ length: 20 }, (_, n) => carried({ id: id(600 + n), name: `T${n}` }));

  it('a contact carrying 20 tags: suggestions and create disabled, remove still works', async () => {
    renderControl(twenty);
    await openControl();
    expect(
      within(popover()).getByText(
        'A contact can carry at most 20 tags. Remove one to add another.',
      ),
    ).toBeInTheDocument();
    expect(option('VIP')).toBeDisabled();
    type('new one');
    expect(option(/^Create tag/)).toBeDisabled();
    expect(within(popover()).getByRole('button', { name: 'Remove tag T0' })).toBeEnabled();
  });

  it('409 CONTACT_TAG_LIMIT_REACHED shows the per-contact limit', async () => {
    api.addContactTag.mockRejectedValue(
      refusal(409, ErrorCode.CONTACT_TAG_LIMIT_REACHED, { limit: 20 }),
    );
    renderControl([]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    expect(
      within(popover()).getByText(
        'A contact can carry at most 20 tags. Remove one to add another.',
      ),
    ).toBeInTheDocument();
  });

  it('409 CONTACT_TAG_LIMIT_REACHED re-reads the contact: its 20 tags show and the rows are disabled', async () => {
    api.addContactTag.mockRejectedValue(
      refusal(409, ErrorCode.CONTACT_TAG_LIMIT_REACHED, { limit: 20 }),
    );
    api.getContact.mockResolvedValue(contact(twenty));
    renderControl([]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    expect(api.getContact).toHaveBeenCalledWith(WS, C1, { background: true });
    expect(within(popover()).getByRole('button', { name: 'Remove tag T0' })).toBeEnabled();
    expect(option('VIP')).toBeDisabled();
  });

  it('409 TAG_LIMIT_REACHED on create: the workspace limit, picking existing still works', async () => {
    api.addContactTag.mockRejectedValueOnce(
      refusal(409, ErrorCode.TAG_LIMIT_REACHED, { limit: 100 }),
    );
    renderControl([]);
    await openControl();
    type('Brand new');
    fireEvent.click(option(/^Create tag/));
    await flush();
    expect(
      within(popover()).getByText(
        'A workspace can have at most 100 tags. A business owner can merge or delete some in Settings → Tags.',
      ),
    ).toBeInTheDocument();
    type('');
    expect(option('VIP')).toBeEnabled();
  });

  it('404 TAG_NOT_FOUND: says the tag is gone, re-reads the tags and the contact', async () => {
    api.addContactTag.mockRejectedValue(
      refusal(404, ErrorCode.TAG_NOT_FOUND, { tag_id: WHOLESALE.id }),
    );
    renderControl([]);
    await openControl();
    api.listTags.mockResolvedValue({ workspace_id: WS, items: [KYIV, VIP] });
    fireEvent.click(option('Wholesale'));
    await flush();
    expect(within(popover()).getByText('This tag no longer exists.')).toBeInTheDocument();
    expect(api.listTags).toHaveBeenCalledTimes(2);
    expect(api.getContact).toHaveBeenCalledWith(WS, C1, { background: true });
    expect(optionNames()).toEqual(['Kyiv', 'VIP']);
  });

  it('429: counts down to retry_at with add and remove disabled, then the alert goes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    api.addContactTag.mockRejectedValue(
      refusal(429, ErrorCode.TAG_CHANGE_LIMIT_REACHED, {
        limit: 60,
        window_seconds: 60,
        retry_at: '2026-10-19T12:00:14Z',
      }),
    );
    renderControl([carried(KYIV)]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    expect(
      within(popover()).getByText(
        'Tag changes are limited to 60 a minute. You can continue in 14 s.',
      ),
    ).toBeInTheDocument();
    expect(option('Vintage')).toBeDisabled();
    expect(within(popover()).getByRole('button', { name: 'Remove tag Kyiv' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(4000));
    expect(within(popover()).getByText(/You can continue in 10 s\./)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(within(popover()).queryByText(/Tag changes are limited/)).toBeNull();
    expect(option('Vintage')).toBeEnabled();
  });

  it('network / 500: a destructive alert, controls enabled again, nothing changed', async () => {
    api.addContactTag.mockRejectedValue(new Error('offline'));
    renderControl([carried(KYIV)]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    const alert = within(popover()).getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't change the tags — try again.");
    expect(option('VIP')).toBeEnabled();
    expect(within(popover()).queryByRole('button', { name: 'Remove tag VIP' })).toBeNull();
  });

  it('404 NOT_FOUND for the contact: the control closes and the host re-reads', async () => {
    api.addContactTag.mockRejectedValue(refusal(404, ErrorCode.NOT_FOUND));
    api.getContact.mockRejectedValue(refusal(404, ErrorCode.NOT_FOUND));
    renderControl([]);
    await openControl();
    fireEvent.click(option('VIP'));
    await flush();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.getContact).toHaveBeenCalled();
    expect(useContactsStore.getState().header?.status).toBe('not_found');
  });
});

describe('SCR-20 live, keyboard and focus', () => {
  it('live: carried badges and suggestions re-render, the typed text stays', async () => {
    renderControl([]);
    await openControl();
    type('w');
    expect(optionNames()).toEqual(['Wholesale', 'Create tag "w"']);
    act(() => {
      useTagsStore.getState().replace(WS, [KYIV, VIP]);
      useContactsStore.getState().applyTags(WS, C1, [carried(KYIV)], vi.fn());
    });
    expect(input()).toHaveValue('w');
    expect(optionNames()).toEqual(['Create tag "w"']);
    expect(within(popover()).getByRole('button', { name: 'Remove tag Kyiv' })).toBeInTheDocument();
  });

  it('reopened after a tags.changed while closed: the tags are read again in the background', async () => {
    renderControl([]);
    await openControl();
    expect(optionNames()).toHaveLength(5);
    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // a teammate deleted three tags while the control was closed
    api.listTags.mockResolvedValue({ workspace_id: WS, items: [KYIV, VIP] });
    await openControl();
    expect(api.listTags).toHaveBeenLastCalledWith(WS, { background: true });
    expect(optionNames()).toEqual(['Kyiv', 'VIP']);
  });

  it('removing a tag keeps focus in the control: the search input takes it', async () => {
    api.removeContactTag.mockResolvedValue(removed([carried(VIP)]));
    renderControl([carried(VIP), carried(WHOLESALE)]);
    await openControl();
    const remove = within(popover()).getByRole('button', { name: 'Remove tag Wholesale' });
    remove.focus();
    fireEvent.click(remove);
    await flush();
    expect(input()).toHaveFocus();
  });

  it('Up / Down move the active option, Enter picks it, Esc closes and focus returns to Add tag', async () => {
    api.addContactTag.mockResolvedValue(added(VINTAGE, [carried(VINTAGE)]));
    renderControl([carried(KYIV)]);
    await openControl();
    type('v');
    // Vintage, VIP, Kyiv VIP clients, Create tag "v"
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', option('VIP').id);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', option('Vintage').id);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', option(/^Create tag/).id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await flush();
    expect(api.addContactTag).toHaveBeenCalledWith(WS, C1, {
      tag_id: VINTAGE.id,
      source: 'inbox',
    });
    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger()).toHaveFocus();
  });

  it('phone: the popover takes the viewport width minus the gutters, rows are 44 px tall', async () => {
    renderControl([]);
    await openControl();
    expect(popover()).toHaveClass('w-[calc(100vw-2rem)]');
    expect(option('VIP')).toHaveClass('min-h-11');
  });
});
