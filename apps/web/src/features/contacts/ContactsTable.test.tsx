import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type ContactPage,
  type ContactRow,
  type InboxBotStatus,
  type TagWithCount,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  listContacts: vi.fn(),
  listTags: vi.fn(),
  getInboxBotStatus: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listContacts: (...a: unknown[]) => api.listContacts(...a),
}));
vi.mock('@/features/tags/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tags/api')>()),
  listTags: (...a: unknown[]) => api.listTags(...a),
}));
vi.mock('@/features/inbox/api-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/api-source')>()),
  getInboxBotStatus: (...a: unknown[]) => api.getInboxBotStatus(...a),
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: () => () => undefined,
  liveStatus: () => 'idle',
}));

import { formatBotDay, formatBotTime } from '@/features/bot/settings/format';
import { formatFullDay } from './format';
import { useContactsStore } from './store';
import { useTagsStore } from '@/features/tags/store';
import { ContactsPage } from '@/pages/ContactsPage';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const WS2 = '0198f0c0-0000-7000-8000-000000000002';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TAG_VIP = id(302);
const TAG_KYIV = id(301);
const NOW = new Date('2026-10-19T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const row = (n: number, over: Partial<ContactRow> = {}): ContactRow => ({
  id: id(900 + n),
  workspace_id: WS,
  first_name: `Customer${n}`,
  last_name: `Surname${n}`,
  username: `user${n}`,
  language_code: 'uk',
  first_wrote_at: ago(30 * 86_400_000),
  last_wrote_at: ago(3 * 60_000),
  blocked_since: null,
  tags: [],
  ...over,
});
const page = (over: Partial<ContactPage> = {}): ContactPage => ({
  workspace_id: WS,
  filter: { q: null, mode: 'any', tag_ids: [] },
  items: [row(1), row(2)],
  has_prev: false,
  has_next: false,
  next_cursor: null,
  matching_count: 2,
  total_count: 2,
  missing_tag_ids: [],
  ...over,
});
const tags: TagWithCount[] = [
  { id: TAG_KYIV, name: 'Kyiv', contact_count: 30 },
  { id: TAG_VIP, name: 'VIP', contact_count: 14 },
];
const bot = (state: InboxBotStatus['state']): InboxBotStatus => ({
  workspace_id: WS,
  state,
  can_reply: state === 'connected',
  receiving: state === 'connected',
});

const guard = vi.fn();
const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
};
const GoTo = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void navigate(`/w/${WS2}/contacts`)}>
        go-other
      </button>
      <button type="button" onClick={() => void navigate(-1)}>
        go-back
      </button>
    </>
  );
};

function renderTable(path = `/w/${WS}/contacts`, role: 'owner' | 'operator' = 'operator') {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <GoTo />
        <Routes>
          <Route path="/w/:workspaceId/contacts" element={<ContactsPage />} />
          <Route path="/w/:workspaceId/contacts/:contactId" element={<p>profile page</p>} />
          <Route path="/w/:workspaceId/settings/bot" element={<p>bot settings</p>} />
        </Routes>
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}
const where = () => screen.getByTestId('where').textContent;
const lastCall = () => api.listContacts.mock.calls.at(-1) as unknown[];
const search = () => screen.getByRole('textbox', { name: /Search by name or username/i });
const tagsButton = () => screen.getByRole('button', { name: /^(Tags|All of|No tags)/ });
const rowsOf = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  api.listContacts.mockResolvedValue(page());
  api.listTags.mockResolvedValue({ workspace_id: WS, items: tags });
  api.getInboxBotStatus.mockResolvedValue(bot('connected'));
  useContactsStore.getState().clear();
  useTagsStore.getState().clear();
  // The relative times in the rows are read against a fixed «now»; timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('SCR-18 loading and default', () => {
  it('shows eight skeleton rows and a short count skeleton while the first page loads', async () => {
    api.listContacts.mockReturnValue(new Promise(() => undefined));
    renderTable();
    expect(await screen.findAllByTestId('contact-skeleton')).toHaveLength(8);
    expect(screen.getByTestId('count-skeleton')).toBeInTheDocument();
    expect(search()).toBeEnabled();
  });

  it('lists the contacts: name link to the profile, @username, language name, first and last wrote, the total count', async () => {
    api.listContacts.mockResolvedValue(
      page({
        items: [
          row(1, {
            tags: [
              { id: TAG_VIP, name: 'VIP' },
              { id: TAG_KYIV, name: 'Kyiv' },
            ],
          }),
          row(2),
        ],
        total_count: 120,
        matching_count: 120,
      }),
    );
    renderTable();
    expect(await screen.findByText('120 contacts')).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
    const first = rowsOf()[0]!;
    const link = within(first).getByRole('link', { name: 'Customer1 Surname1' });
    expect(link).toHaveAttribute('href', `/w/${WS}/contacts/${id(901)}`);
    expect(within(first).getByText('@user1')).toBeInTheDocument();
    expect(within(first).getByText('Ukrainian')).toBeInTheDocument();
    expect(within(first).getByText(formatBotDay(ago(30 * 86_400_000)))).toBeInTheDocument();
    const last = within(first).getByText('3m');
    expect(last).toHaveAttribute('title', formatBotTime(ago(3 * 60_000)));
    expect(within(first).getByText('VIP')).toBeInTheDocument();
    expect(within(first).getByText('Kyiv')).toBeInTheDocument();
  });

  it('says «1 contact» for one', async () => {
    api.listContacts.mockResolvedValue(
      page({ items: [row(1)], total_count: 1, matching_count: 1 }),
    );
    renderTable();
    expect(await screen.findByText('1 contact')).toBeInTheDocument();
  });

  it('shows words, not blanks: no username, Unknown language, Never wrote, and a missing last name left out', async () => {
    api.listContacts.mockResolvedValue(
      page({
        items: [
          row(1, {
            last_name: null,
            username: null,
            language_code: null,
            first_wrote_at: null,
            last_wrote_at: null,
            blocked_since: null,
          }),
        ],
      }),
    );
    renderTable();
    const link = await screen.findByRole('link', { name: 'Customer1' });
    const only = link.closest('tr')!;
    expect(within(only).getByText('no username')).toBeInTheDocument();
    expect(within(only).getByText('Unknown')).toBeInTheDocument();
    expect(within(only).getAllByText('Never')).toHaveLength(2);
  });

  it('shows the code of a language it cannot name', async () => {
    api.listContacts.mockResolvedValue(
      page({ items: [row(1, { language_code: 'zz-invalid-xx' })] }),
    );
    renderTable();
    expect(await screen.findByText('zz-invalid-xx')).toBeInTheDocument();
  });

  it('collapses more than 3 tags into «+N» with the full list in its title', async () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: id(400 + i), name }));
    api.listContacts.mockResolvedValue(page({ items: [row(1, { tags: many })] }));
    renderTable();
    const first = (await screen.findByRole('link', { name: 'Customer1 Surname1' })).closest('tr')!;
    for (const name of ['A', 'B', 'C']) expect(within(first).getByText(name)).toBeInTheDocument();
    expect(within(first).queryByText('D')).not.toBeInTheDocument();
    const more = within(first).getByText('+2');
    expect(more).toHaveAttribute('title', 'A, B, C, D, E');
  });

  it('hides the Language and First wrote columns on a phone (below md)', async () => {
    renderTable();
    await screen.findByRole('table');
    const language = screen.getByRole('columnheader', { name: 'Language' });
    const first = screen.getByRole('columnheader', { name: 'First wrote' });
    expect(language.className).toMatch(/hidden md:table-cell/);
    expect(first.className).toMatch(/hidden md:table-cell/);
    expect(screen.getByRole('columnheader', { name: 'Last wrote' }).className).not.toMatch(
      /hidden/,
    );
  });
});

describe('SCR-18 show more', () => {
  it('loads the next page after the cursor, appends it without repeats and drops the button at the end', async () => {
    api.listContacts.mockResolvedValueOnce(
      page({ items: [row(1), row(2)], has_next: true, next_cursor: 'cur1', total_count: 4 }),
    );
    renderTable();
    await screen.findByRole('table');
    api.listContacts.mockResolvedValueOnce(page({ items: [row(2), row(3)], total_count: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
    expect(lastCall()[1]).toMatchObject({ after: 'cur1' });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows a spinner on Show more and disables it while the next page loads', async () => {
    api.listContacts.mockResolvedValueOnce(
      page({ has_next: true, next_cursor: 'cur1', total_count: 4 }),
    );
    renderTable();
    await screen.findByRole('table');
    let finish!: (p: ContactPage) => void;
    api.listContacts.mockReturnValueOnce(new Promise((r) => (finish = r)));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    const more = await screen.findByRole('button', { name: 'Show more' });
    await waitFor(() => expect(more).toBeDisabled());
    expect(within(more).getByTestId('more-spinner')).toBeInTheDocument();
    await act(async () => finish(page({ items: [row(3)], total_count: 4 })));
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('keeps the rows and offers Retry when the next page fails', async () => {
    api.listContacts.mockResolvedValueOnce(
      page({ has_next: true, next_cursor: 'cur1', total_count: 4 }),
    );
    renderTable();
    await screen.findByRole('table');
    api.listContacts.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText("Couldn't load more contacts")).toBeInTheDocument();
    expect(rowsOf()).toHaveLength(2);
    api.listContacts.mockResolvedValueOnce(page({ items: [row(3)], total_count: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rowsOf()).toHaveLength(3));
  });
});

describe('SCR-18 search, filter and the address', () => {
  it('opens a filtered address as the same view: search, mode, tags and «N of M contacts match»', async () => {
    api.listContacts.mockResolvedValue(
      page({
        items: [row(1)],
        matching_count: 14,
        total_count: 120,
        filter: { q: 'ada', mode: 'all', tag_ids: [TAG_VIP] },
      }),
    );
    renderTable(`/w/${WS}/contacts?q=ada&mode=all&tag=${TAG_VIP}`);
    expect(await screen.findByText('14 of 120 contacts match')).toBeInTheDocument();
    expect(search()).toHaveValue('ada');
    expect(await screen.findByRole('button', { name: 'All of 1 tag' })).toBeInTheDocument();
    expect(lastCall()[1]).toEqual({ q: 'ada', mode: 'all', tag: [TAG_VIP] });
  });

  it('writes the search to the address after 300 ms as a history entry, and the back button walks back', async () => {
    renderTable();
    await screen.findByRole('table');
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fireEvent.change(search(), { target: { value: 'ad' } });
    fireEvent.change(search(), { target: { value: 'ada' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(where()).toBe(`/w/${WS}/contacts`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(where()).toBe(`/w/${WS}/contacts?q=ada`);
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await waitFor(() => expect(lastCall()[1]).toMatchObject({ q: 'ada' }));
    fireEvent.click(screen.getByRole('button', { name: 'go-back' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts`));
    await waitFor(() => expect(search()).toHaveValue(''));
  });

  it('keeps a typed trailing space while the search is written, so the next word joins it', async () => {
    renderTable();
    await screen.findByRole('table');
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fireEvent.change(search(), { target: { value: 'John ' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(where()).toBe(`/w/${WS}/contacts?q=John`);
    expect(search()).toHaveValue('John ');
    fireEvent.change(search(), { target: { value: 'John Smith' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(where()).toBe(`/w/${WS}/contacts?q=John+Smith`);
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  it('takes at most 200 characters of search and at most 100 tag ids from the address', async () => {
    const ids = Array.from({ length: 101 }, (_, n) => id(1000 + n));
    renderTable(`/w/${WS}/contacts?q=${'a'.repeat(250)}&${ids.map((t) => `tag=${t}`).join('&')}`);
    await screen.findByRole('table');
    expect(search()).toHaveAttribute('maxLength', '200');
    await waitFor(() => expect(lastCall()[1]).toMatchObject({ q: 'a'.repeat(200) }));
    expect(
      api.listContacts.mock.calls.every(
        (c) =>
          (c[1] as { q: string }).q.length <= 200 && (c[1] as { tag: string[] }).tag.length <= 100,
      ),
    ).toBe(true);
    expect((lastCall()[1] as { tag: string[] }).tag).toEqual(ids.slice(0, 100));
  });

  it('the Tags filter shows skeletons while the tags load and Retry when they fail', async () => {
    api.listTags.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    renderTable();
    await screen.findByRole('table');
    fireEvent.click(tagsButton());
    expect(await screen.findByText("Couldn't load the tags")).toBeInTheDocument();
    expect(screen.queryByText(/No tags yet/)).not.toBeInTheDocument();
    let finish!: (v: unknown) => void;
    api.listTags.mockReturnValueOnce(new Promise((r) => (finish = r)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByTestId('tag-filter-skeleton')).toHaveLength(3);
    await act(async () => finish({ workspace_id: WS, items: tags }));
    expect(await screen.findByRole('checkbox', { name: /VIP/ })).toBeInTheDocument();
  });

  it('writes the mode and the tag ids to the address as history entries', async () => {
    renderTable();
    await screen.findByRole('table');
    fireEvent.click(tagsButton());
    fireEvent.click(await screen.findByRole('checkbox', { name: /VIP/ }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?tag=${TAG_VIP}`));
    fireEvent.click(screen.getByRole('radio', { name: 'All of these tags' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?mode=all&tag=${TAG_VIP}`));
    await waitFor(() => expect(lastCall()[1]).toEqual({ q: '', mode: 'all', tag: [TAG_VIP] }));
    fireEvent.click(screen.getByRole('radio', { name: 'No tags' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?mode=none`));
  });

  it('cleans an address the API would refuse before any request (bad ids, a repeat, an unknown mode)', async () => {
    renderTable(`/w/${WS}/contacts?mode=bogus&tag=nope&tag=${TAG_VIP}&tag=${TAG_VIP}`);
    await screen.findByRole('table');
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?tag=${TAG_VIP}`));
    expect(
      api.listContacts.mock.calls.every(
        (c) => JSON.stringify(c[1]) === JSON.stringify({ q: '', mode: 'any', tag: [TAG_VIP] }),
      ),
    ).toBe(true);
  });

  it('drops the tags that come with mode none before any request', async () => {
    renderTable(`/w/${WS}/contacts?mode=none&tag=${TAG_VIP}`);
    await screen.findByRole('table');
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?mode=none`));
    expect(
      api.listContacts.mock.calls.every(
        (c) => JSON.stringify(c[1]) === JSON.stringify({ q: '', mode: 'none', tag: [] }),
      ),
    ).toBe(true);
  });

  it('removes a tag id the workspace no longer has from the address and says so until the filter changes', async () => {
    const gone = id(399);
    api.listContacts.mockResolvedValueOnce(
      page({ missing_tag_ids: [gone], filter: { q: null, mode: 'any', tag_ids: [TAG_VIP] } }),
    );
    renderTable(`/w/${WS}/contacts?tag=${gone}&tag=${TAG_VIP}`);
    expect(
      await screen.findByText(
        'One of the chosen tags no longer exists, so it was left out of the filter.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?tag=${TAG_VIP}`));
    // the rows are still shown, and the notice stays through the re-read
    await screen.findByRole('table');
    expect(
      screen.getByText(
        'One of the chosen tags no longer exists, so it was left out of the filter.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(tagsButton());
    fireEvent.click(await screen.findByRole('checkbox', { name: /Kyiv/ }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          'One of the chosen tags no longer exists, so it was left out of the filter.',
        ),
      ).not.toBeInTheDocument(),
    );
  });

  it('a renamed tag filters on under its new name with no notice', async () => {
    api.listTags.mockResolvedValue({
      workspace_id: WS,
      items: [{ id: TAG_VIP, name: 'Loyal', contact_count: 3 }],
    });
    renderTable(`/w/${WS}/contacts?tag=${TAG_VIP}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Tags · 1' }));
    expect(await screen.findByRole('checkbox', { name: /Loyal/ })).toBeChecked();
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
  });

  it('a workspace switch starts with no search and no filter', async () => {
    renderTable(`/w/${WS}/contacts?q=ada&mode=all&tag=${TAG_VIP}`);
    await screen.findByRole('table');
    expect(search()).toHaveValue('ada');
    fireEvent.click(screen.getByRole('button', { name: 'go-other' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS2}/contacts`));
    await waitFor(() => expect(search()).toHaveValue(''));
    expect(api.listContacts.mock.calls.at(-1)![0]).toBe(WS2);
    expect(lastCall()[1]).toEqual({ q: '', mode: 'any', tag: [] });
    expect(tagsButton()).toHaveTextContent('Tags');
  });
});

describe('SCR-18 empty states and errors', () => {
  it('replaces the table with «No contacts match…» and a Clear button that clears the whole address', async () => {
    api.listContacts.mockImplementation(async (_ws: string, params: { q?: string }) =>
      params.q
        ? page({ items: [], matching_count: 0, total_count: 120 })
        : page({ total_count: 120 }),
    );
    renderTable(`/w/${WS}/contacts?q=zzz&mode=all&tag=${TAG_VIP}`);
    expect(await screen.findByText('No contacts match your search and filter')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts`));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(search()).toHaveValue('');
  });

  const noContacts = () => page({ items: [], total_count: 0, matching_count: 0 });

  it('owner without a connected bot: the empty card with Connect bot to the bot settings, no toolbar', async () => {
    api.listContacts.mockResolvedValue(noContacts());
    api.getInboxBotStatus.mockResolvedValue(bot('not_connected'));
    renderTable(`/w/${WS}/contacts`, 'owner');
    expect(
      await screen.findByText(
        'No contacts yet. A contact appears when a customer writes to your business bot.',
      ),
    ).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Connect bot' });
    expect(link).toHaveAttribute('href', `/w/${WS}/settings/bot`);
    expect(screen.queryByRole('textbox', { name: /Search/i })).not.toBeInTheDocument();
  });

  it('operator, or an owner with a connected bot: the card without a button, no toolbar', async () => {
    api.listContacts.mockResolvedValue(noContacts());
    api.getInboxBotStatus.mockResolvedValue(bot('not_connected'));
    const operator = renderTable(`/w/${WS}/contacts`, 'operator');
    expect(
      await screen.findByText(
        'No contacts yet. A contact appears when a customer writes to the business bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect bot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Search/i })).not.toBeInTheDocument();
    expect(api.getInboxBotStatus).not.toHaveBeenCalled();
    operator.unmount();
    useContactsStore.getState().clear();
    api.getInboxBotStatus.mockResolvedValue(bot('connected'));
    renderTable(`/w/${WS}/contacts`, 'owner');
    expect(
      await screen.findByText(
        'No contacts yet. A contact appears when a customer writes to the business bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect bot' })).not.toBeInTheDocument();
  });

  it('a filtered address of a workspace with no contacts: the no-contacts card, not «nothing matches»', async () => {
    api.listContacts.mockResolvedValue(noContacts());
    renderTable(`/w/${WS}/contacts?q=ada&tag=${TAG_VIP}`);
    expect(
      await screen.findByText(
        'No contacts yet. A contact appears when a customer writes to the business bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('No contacts match your search and filter')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Search/i })).not.toBeInTheDocument();
  });

  it("owner: no text until the bot status answers, then the owner's text", async () => {
    api.listContacts.mockResolvedValue(noContacts());
    let answer!: (b: InboxBotStatus) => void;
    api.getInboxBotStatus.mockReturnValue(new Promise((r) => (answer = r)));
    renderTable(`/w/${WS}/contacts`, 'owner');
    expect(await screen.findByTestId('empty-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/No contacts yet/)).not.toBeInTheDocument();
    await act(async () => answer(bot('not_connected')));
    expect(
      await screen.findByText(
        'No contacts yet. A contact appears when a customer writes to your business bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('empty-skeleton')).not.toBeInTheDocument();
  });

  it('owner: a failed bot status read shows the plain no-contacts card', async () => {
    api.listContacts.mockResolvedValue(noContacts());
    api.getInboxBotStatus.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    renderTable(`/w/${WS}/contacts`, 'owner');
    expect(
      await screen.findByText(
        'No contacts yet. A contact appears when a customer writes to the business bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect bot' })).not.toBeInTheDocument();
  });

  it("shows «Couldn't load contacts» with Retry when the first read fails", async () => {
    api.listContacts.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    renderTable();
    expect(await screen.findByText("Couldn't load contacts")).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    api.listContacts.mockResolvedValueOnce(page());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('shows a 400 that still arrives as the error state', async () => {
    api.listContacts.mockRejectedValueOnce(new ApiError(400, ErrorCode.VALIDATION_ERROR, 'x'));
    renderTable();
    expect(await screen.findByText("Couldn't load contacts")).toBeInTheDocument();
  });

  it('hands a 401 (sign-in returns to the same address) and a 403 access removed to the shell guard', async () => {
    const path = `/w/${WS}/contacts?q=ada&mode=all&tag=${TAG_VIP}`;
    api.listContacts.mockRejectedValueOnce(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'));
    const first = renderTable(path);
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
    expect(guard.mock.calls[0]![0]).toMatchObject({ status: 401 });
    expect(guard.mock.calls[0]![1]).toBe(WS);
    // the address is untouched: the guard saves it as the sign-in return address
    expect(where()).toBe(path);
    first.unmount();
    useContactsStore.getState().clear();
    api.listContacts.mockRejectedValueOnce(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'));
    renderTable(path);
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(2));
    expect(guard.mock.calls[1]![0]).toMatchObject({ status: 403, code: ErrorCode.ACCESS_REMOVED });
  });

  it("opens a contact's profile from its name and the back address is the same list", async () => {
    renderTable(`/w/${WS}/contacts?q=ada`);
    const link = await screen.findByRole('link', { name: 'Customer1 Surname1' });
    fireEvent.click(link);
    expect(await screen.findByText('profile page')).toBeInTheDocument();
    expect(where()).toBe(`/w/${WS}/contacts/${id(901)}`);
    fireEvent.click(screen.getByRole('button', { name: 'go-back' }));
    await waitFor(() => expect(where()).toBe(`/w/${WS}/contacts?q=ada`));
  });
});

describe('SCR-18 blocked the bot (AC-14)', () => {
  it('marks a row whose contact blocked the bot, with the day in the title; no marker otherwise', async () => {
    const since = '2026-10-20T11:00:00.000Z';
    api.listContacts.mockResolvedValue(page({ items: [row(1, { blocked_since: since }), row(2)] }));
    renderTable();
    await screen.findByText('2 contacts');
    const [blocked, other] = rowsOf();
    const badge = within(blocked!).getByText('Blocked the bot');
    expect(badge).toHaveAttribute('title', `Blocked the bot since ${formatFullDay(since)}`);
    expect(within(other!).queryByText('Blocked the bot')).toBeNull();
  });

  it('shows no marker at all when nothing is blocked (no bot)', async () => {
    renderTable();
    await screen.findByText('2 contacts');
    expect(screen.queryByText('Blocked the bot')).toBeNull();
  });
});
