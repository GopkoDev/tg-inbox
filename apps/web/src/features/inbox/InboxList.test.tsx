import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Conversation, InboxBotStatus } from '@tg/shared';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { stubRadixDom } from '@/test/radix';

const api = { listConversations: vi.fn() };
vi.mock('./api-source', () => ({
  listConversations: (...a: unknown[]) => api.listConversations(...a),
}));
vi.mock('./Thread', () => ({ Thread: () => <div data-testid="thread" /> }));

import { InboxList } from './InboxList';
import type { InboxLens } from './lens';
import { useInboxStore } from './store';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const cid = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-18T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const OLENA = { account_id: cid(900), display_name: 'Olena Kravets' };

const conv = (n: number, over: Partial<Conversation> = {}): Conversation => ({
  id: cid(100 + n),
  workspace_id: WS,
  contact: { id: cid(200 + n), first_name: `Name${n}`, last_name: null, username: null },
  last_activity_at: ago(n * 60_000),
  last_item: { type: 'message', id: cid(300 + n), kind: 'text', body: `hello ${n}` },
  unread_count: 0,
  waiting_for_reply: false,
  status: 'open',
  assignee: null,
  state_version: 0,
  ...over,
});

const bot = (state: InboxBotStatus['state']): InboxBotStatus => ({
  workspace_id: WS,
  state,
  can_reply: state === 'connected' || state === 'taken_over',
  receiving: state === 'connected',
});

const seed = (patch: Partial<ReturnType<typeof useInboxStore.getState>> = {}) =>
  useInboxStore.setState({
    workspaceId: WS,
    listStatus: 'ready',
    conversations: [],
    hasNext: false,
    nextCursor: null,
    bot: bot('connected'),
    thread: null,
    live: 'live',
    guardError: null,
    lens: { status: 'open', assignee: 'all' },
    searching: false,
    ...patch,
  });
const lens = (status: InboxLens['status'], assignee: InboxLens['assignee']) => ({
  lens: { status, assignee },
});

const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
};
function renderList(role: 'owner' | 'operator' = 'operator', path = `/w/${WS}/inbox`) {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/w/:workspaceId/inbox" element={<InboxList />} />
        <Route path="/w/:workspaceId/inbox/:conversationId" element={<InboxList />} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent;
const tab = (name: string) => screen.getByRole('tab', { name });
const search = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: text } });
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
};
const searchPage = (items: Conversation[], assignee = 'all') => ({
  workspace_id: WS,
  lens: { status: null, assignee },
  items,
  has_prev: false,
  has_next: false,
  next_cursor: null,
});

beforeEach(() => {
  stubRadixDom();
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  api.listConversations.mockReset();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SCR-01 lens controls (AC-01)', () => {
  it('default: Open selected, Closed available, assignee All, rows with their assignee line', () => {
    seed({ conversations: [conv(1), conv(2, { assignee: OLENA })] });
    renderList();
    expect(tab('Open')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Closed')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('All');
    expect(
      within(screen.getByRole('link', { name: /Name1/ })).getByText('Unassigned'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('link', { name: /Name2/ })).getByText('Olena Kravets'),
    ).toBeVisible();
    expect(screen.queryByText('Searching open and closed')).toBeNull();
  });

  it('lens from the address (via the store): Closed tab and Mine shown, no Closed marks', () => {
    seed({ ...lens('closed', 'mine'), conversations: [conv(1, { status: 'closed' })] });
    renderList('operator', `/w/${WS}/inbox?status=closed&assignee=mine`);
    expect(tab('Closed')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Mine');
    expect(screen.queryByText('Closed', { selector: '[data-slot="badge"]' })).toBeNull();
  });

  it('choosing Closed writes the address and keeps the assignee lens', () => {
    seed(lens('open', 'mine'));
    renderList('operator', `/w/${WS}/inbox?assignee=mine`);
    fireEvent.mouseDown(tab('Closed'));
    fireEvent.click(tab('Closed'));
    expect(where()).toBe(`/w/${WS}/inbox?status=closed&assignee=mine`);
  });

  it('choosing Open again drops the default from the address', () => {
    seed(lens('closed', 'all'));
    renderList('operator', `/w/${WS}/inbox?status=closed`);
    fireEvent.mouseDown(tab('Open'));
    fireEvent.click(tab('Open'));
    expect(where()).toBe(`/w/${WS}/inbox`);
  });

  it.each([
    ['Mine', 'mine'],
    ['Unassigned', 'unassigned'],
  ])('choosing %s in the assignee select writes the address', (label, value) => {
    seed();
    renderList();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Assignee' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: label }));
    expect(where()).toBe(`/w/${WS}/inbox?assignee=${value}`);
  });

  it('keeps other address parameters when a lens changes', () => {
    seed();
    renderList('operator', `/w/${WS}/inbox?x=1`);
    fireEvent.mouseDown(tab('Closed'));
    fireEvent.click(tab('Closed'));
    expect(where()).toBe(`/w/${WS}/inbox?x=1&status=closed`);
  });

  it('loading a lens: 6 skeleton rows and the controls stay enabled', () => {
    seed({ listStatus: 'loading', bot: null, ...lens('closed', 'all') });
    renderList();
    expect(screen.getAllByTestId('conversation-skeleton')).toHaveLength(6);
    expect(tab('Open')).toBeEnabled();
    expect(tab('Closed')).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeEnabled();
  });

  it('error: Retry re-reads the first page in the current lenses', async () => {
    seed({ listStatus: 'error', ...lens('closed', 'mine') });
    const enter = vi.fn().mockResolvedValue(undefined);
    useInboxStore.setState({ enter });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(enter).toHaveBeenCalledWith(WS, { status: 'closed', assignee: 'mine' });
  });

  it('renders an assignee name as plain text', () => {
    seed({
      conversations: [
        conv(1, { assignee: { account_id: cid(901), display_name: '<img onerror=x>' } }),
      ],
    });
    const { container } = renderList();
    expect(screen.getByText('<img onerror=x>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('SCR-01 empty lenses (AC-01)', () => {
  it.each([
    [
      'open',
      'all',
      'No open conversations. New ones appear here when customers write to your bot.',
    ],
    ['open', 'mine', 'No open conversations are assigned to you.'],
    ['open', 'unassigned', 'Every open conversation has an assignee.'],
    ['closed', 'all', 'No closed conversations.'],
    ['closed', 'mine', 'No closed conversations are assigned to you.'],
    ['closed', 'unassigned', 'No closed conversations without an assignee.'],
  ] as const)('%s · %s', (status, assignee, text) => {
    seed(lens(status, assignee));
    renderList();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText('Open bot settings')).toBeNull();
  });

  it('no bot, owner: the open · all sentence, then the connect hint and the link', () => {
    seed({ bot: bot('not_connected') });
    renderList('owner');
    expect(
      screen.getByText(
        'No open conversations. New ones appear here when customers write to your bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Connect the bot to start receiving messages.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open bot settings' })).toBeInTheDocument();
  });

  it('no bot, operator: asks a business owner', () => {
    seed({ bot: bot('needs_token') });
    renderList('operator');
    expect(screen.getByText('Ask a business owner to connect the bot.')).toBeInTheDocument();
  });

  it('no bot but another lens: only that lens sentence', () => {
    seed({ bot: bot('not_connected'), ...lens('open', 'mine') });
    renderList('owner');
    expect(screen.getByText('No open conversations are assigned to you.')).toBeInTheDocument();
    expect(screen.queryByText('Connect the bot to start receiving messages.')).toBeNull();
  });
});

describe('SCR-01 searching (AC-01)', () => {
  it('disables the status tabs with the hint, keeps the assignee select, marks closed rows', async () => {
    api.listConversations.mockResolvedValue(
      searchPage([conv(1, { status: 'closed', assignee: OLENA }), conv(2)]),
    );
    seed({ conversations: [conv(2)] });
    renderList();
    await search('name');
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({ q: 'name', assignee: 'all' });
    expect(tab('Open')).toBeDisabled();
    expect(tab('Closed')).toBeDisabled();
    expect(screen.getByText('Searching open and closed')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeEnabled();
    const closed = screen.getByRole('link', { name: /Name1/ });
    expect(within(closed).getByText('Closed')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Name2/ })).queryByText('Closed')).toBeNull();
  });

  it('searches within the chosen assignee lens', async () => {
    api.listConversations.mockResolvedValue(searchPage([], 'mine'));
    seed(lens('open', 'mine'));
    renderList();
    await search('zzz');
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({ q: 'zzz', assignee: 'mine' });
    expect(screen.getByText('No conversations match')).toBeInTheDocument();
  });

  it('clearing the search returns to the lenses chosen before', async () => {
    api.listConversations.mockResolvedValue(searchPage([conv(1, { status: 'closed' })]));
    seed({ ...lens('closed', 'all'), conversations: [conv(1, { status: 'closed' })] });
    renderList();
    await search('name');
    expect(useInboxStore.getState().searching).toBe(true);
    await search('');
    expect(useInboxStore.getState().searching).toBe(false);
    expect(screen.queryByText('Searching open and closed')).toBeNull();
    expect(tab('Closed')).toBeEnabled();
    expect(tab('Closed')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Closed', { selector: '[data-slot="badge"]' })).toBeNull();
  });

  it('empty search result: Clear search goes back to the lenses', async () => {
    api.listConversations.mockResolvedValue(searchPage([]));
    seed({ conversations: [conv(1)] });
    renderList();
    await search('zzz');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByText('Searching open and closed')).toBeNull();
    expect(screen.getByRole('link', { name: /Name1/ })).toBeInTheDocument();
  });
});

describe('SCR-01 live rows (AC-01, AC-07)', () => {
  it('a row joins and leaves the lens without a reload', () => {
    seed({ conversations: [conv(1), conv(2)] });
    renderList();
    act(() => seed({ conversations: [conv(1), conv(2), conv(3)] }));
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toHaveLength(3);
    act(() => seed({ conversations: [conv(1), conv(3)] }));
    expect(screen.queryByRole('link', { name: /Name2/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Name3/ })).toBeInTheDocument();
  });

  it('a reassigned row is updated in place and keeps its position and preview', () => {
    seed({ conversations: [conv(1), conv(2)] });
    renderList();
    act(() => seed({ conversations: [conv(1, { assignee: OLENA }), conv(2)] }));
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('Name1');
    expect(within(links[0]!).getByText('Olena Kravets')).toBeInTheDocument();
    expect(within(links[0]!).getByText('hello 1')).toBeInTheDocument();
    expect(within(links[0]!).getByText('1m')).toBeInTheDocument();
  });

  it('reopened by the customer: back at the top, unread, waiting, same assignee', () => {
    seed({ ...lens('open', 'all'), conversations: [conv(2)] });
    renderList();
    act(() =>
      seed({
        conversations: [
          conv(1, {
            assignee: OLENA,
            unread_count: 1,
            waiting_for_reply: true,
            last_activity_at: ago(0),
          }),
          conv(2),
        ],
      }),
    );
    const top = screen.getAllByRole('link')[0]!;
    expect(top).toHaveTextContent('Name1');
    expect(within(top).getByLabelText('1 unread')).toBeInTheDocument();
    expect(within(top).getByText('Waiting for a reply')).toBeInTheDocument();
    expect(within(top).getByText('Olena Kravets')).toBeInTheDocument();
  });

  it('selected row left the lens: the row goes, the thread stays open', () => {
    seed({ conversations: [conv(1), conv(2)] });
    renderList('operator', `/w/${WS}/inbox/${conv(2).id}`);
    expect(screen.getByRole('link', { name: /Name2/ })).toHaveAttribute('aria-current', 'true');
    act(() => seed({ conversations: [conv(1)] }));
    expect(screen.queryByRole('link', { name: /Name2/ })).toBeNull();
    expect(screen.getByTestId('thread')).toBeInTheDocument();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('opened outside the lens: the thread opens and no row is selected', () => {
    seed({ conversations: [conv(1)] });
    renderList('operator', `/w/${WS}/inbox/${conv(7).id}`);
    expect(screen.getByTestId('thread')).toBeInTheDocument();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });
});

describe('SCR-01 phone layout (AC-01)', () => {
  it('puts the status tabs (flex-1) and the assignee select (w-36) side by side', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    seed({ conversations: [conv(1)] });
    renderList();
    const tabs = screen.getByRole('tablist');
    const select = screen.getByRole('combobox', { name: 'Assignee' });
    expect(tabs.closest('[data-slot="tabs"]')).toHaveClass('flex-1');
    expect(select).toHaveClass('w-36');
    expect(tabs.closest('[data-testid="lens-controls"]')).toBe(
      select.closest('[data-testid="lens-controls"]'),
    );
    expect(screen.queryByTestId('thread')).toBeNull();
  });
});
