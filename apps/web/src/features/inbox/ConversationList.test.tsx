import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Conversation, InboxBotStatus } from '@tg/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';

const api = { listConversations: vi.fn(), getConversation: vi.fn() };
vi.mock('./api-source', () => ({
  listConversations: (...a: unknown[]) => api.listConversations(...a),
  getConversation: (...a: unknown[]) => api.getConversation(...a),
  listThreadItems: vi.fn(),
  getThreadMessage: vi.fn(),
  getThreadReply: vi.fn(),
  markConversationRead: vi.fn(),
  getInboxBotStatus: vi.fn(),
}));
const live = vi.hoisted(() => ({
  reconnected: null as null | (() => void),
  frame: null as null | ((f: unknown) => void),
}));
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: (
    _ws: string,
    handlers: { onReconnected: () => void; onFrame: (f: unknown) => void },
  ) => {
    live.reconnected = handlers.onReconnected;
    live.frame = handlers.onFrame;
    return vi.fn();
  },
}));

import { InboxPage } from '@/pages/InboxPage';
import { useInboxStore } from './store';
import { InboxList } from './InboxList';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const cid = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-18T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

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

const seed = (patch: Partial<ReturnType<typeof useInboxStore.getState>>) =>
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
    ...patch,
  });

function renderList(role: 'owner' | 'operator' = 'operator', path = `/w/${WS}/inbox`) {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId/inbox" element={<InboxList />} />
        <Route path="/w/:workspaceId/inbox/:conversationId" element={<InboxList />} />
      </Routes>
    </MemoryRouter>,
  );
}

const OPEN = { status: 'open', assignee: 'all' } as const;
const SEARCHING = { status: null, assignee: 'all' } as const;
const flush = () => act(async () => {});

beforeEach(() => {
  // Same workspace id for every test: the store resets itself when the current workspace changes.
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  api.listConversations.mockReset();
  api.getConversation.mockReset();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SCR-01 rows (AC-01)', () => {
  it('shows contact name, last text, relative time, unread badge and the waiting marker', () => {
    seed({
      conversations: [
        conv(2, {
          contact: { id: cid(1), first_name: 'Olena', last_name: 'Kravets', username: 'olena' },
          unread_count: 2,
          waiting_for_reply: true,
        }),
        conv(90),
      ],
    });
    renderList();
    const row = screen.getByRole('link', { name: /Olena Kravets/ });
    expect(within(row).getByText('hello 2')).toBeInTheDocument();
    expect(within(row).getByText('2m')).toBeInTheDocument();
    expect(within(row).getByLabelText('2 unread')).toHaveTextContent('2');
    expect(within(row).getByText('Waiting for a reply')).toBeInTheDocument();
    const other = screen.getByRole('link', { name: /Name90/ });
    expect(within(other).queryByText('Waiting for a reply')).toBeNull();
    expect(within(other).queryByLabelText(/unread/)).toBeNull();
    expect(screen.queryByText('Sample data')).toBeNull();
  });

  it('renders a non-text message by kind and caption, a photo without caption as Photo', () => {
    seed({
      conversations: [
        conv(1, {
          last_item: { type: 'message', id: cid(1), kind: 'photo', body: 'new bouquet?' },
        }),
        conv(2, { last_item: { type: 'message', id: cid(2), kind: 'photo', body: null } }),
      ],
    });
    renderList();
    expect(screen.getByText('Photo · new bouquet?')).toBeInTheDocument();
    expect(screen.getByText('Photo')).toBeInTheDocument();
  });

  it('marks a team reply with the reply icon before its text', () => {
    seed({
      conversations: [conv(1, { last_item: { type: 'reply', id: cid(1), body: 'On Saturday' } })],
    });
    renderList();
    const row = screen.getByRole('link', { name: /Name1/ });
    expect(row.querySelector('svg.lucide-corner-up-left')).not.toBeNull();
    expect(within(row).getByText('On Saturday')).toBeInTheDocument();
  });

  it('renders names and texts as plain text', () => {
    seed({
      conversations: [
        conv(1, {
          contact: { id: cid(1), first_name: '<b>Bold</b>', last_name: null, username: null },
          last_item: { type: 'message', id: cid(1), kind: 'text', body: '<i>x</i>' },
        }),
      ],
    });
    const { container } = renderList();
    expect(screen.getByText('<b>Bold</b>')).toBeInTheDocument();
    expect(screen.getByText('<i>x</i>')).toBeInTheDocument();
    expect(container.querySelector('b, i')).toBeNull();
  });

  it('keeps the store order and highlights the open conversation with aria-current', () => {
    seed({ conversations: [conv(1), conv(2)] });
    renderList('operator', `/w/${WS}/inbox/${conv(2).id}`);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('Name1');
    expect(links[1]).toHaveAttribute('aria-current', 'true');
    expect(links[0]).not.toHaveAttribute('aria-current');
    expect(links[1]).toHaveAttribute('href', `/w/${WS}/inbox/${conv(2).id}`);
  });

  it('opening a conversation keeps the lenses in the address (AC-01)', () => {
    seed({ conversations: [conv(1)] });
    renderList('operator', `/w/${WS}/inbox?status=closed&assignee=mine`);
    expect(screen.getByRole('link', { name: /Name1/ })).toHaveAttribute(
      'href',
      `/w/${WS}/inbox/${conv(1).id}?status=closed&assignee=mine`,
    );
  });

  it('reflects a live change of the store (activity, read elsewhere)', () => {
    seed({ conversations: [conv(1, { unread_count: 3 }), conv(2)] });
    renderList();
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument();
    act(() => seed({ conversations: [conv(2, { unread_count: 1 }), conv(1)] }));
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('Name2');
    expect(screen.queryByLabelText('3 unread')).toBeNull();
    expect(screen.getByLabelText('1 unread')).toBeInTheDocument();
  });

  it('shows the right pane placeholder on desktop and only the list on a phone', () => {
    seed({ conversations: [conv(1)] });
    const { unmount } = renderList();
    expect(screen.getByText('Pick a conversation to see it here')).toBeInTheDocument();
    unmount();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    renderList();
    expect(screen.queryByText('Pick a conversation to see it here')).toBeNull();
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
  });
});

describe('SCR-01 loading and errors', () => {
  it('loading: 6 skeleton rows and a disabled search', () => {
    seed({ listStatus: 'loading', bot: null });
    renderList();
    expect(screen.getAllByTestId('conversation-skeleton')).toHaveLength(6);
    expect(screen.getByLabelText('Search conversations')).toBeDisabled();
  });

  it('error: Something went wrong with Retry that re-enters the workspace', async () => {
    api.listConversations.mockResolvedValue({
      workspace_id: WS,
      lens: OPEN,
      items: [conv(1)],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    seed({ listStatus: 'error' });
    renderList();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(api.listConversations).toHaveBeenCalled();
    expect(useInboxStore.getState().listStatus).toBe('ready');
    expect(screen.getByRole('link', { name: /Name1/ })).toBeInTheDocument();
  });
});

describe('SCR-01 empty states (AC-02)', () => {
  it('no conversations, connected bot', () => {
    seed({ bot: bot('connected') });
    renderList();
    expect(
      screen.getByText(
        'No open conversations. New ones appear here when customers write to your bot.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Open bot settings')).toBeNull();
  });

  it('no bot, business owner: link to the bot settings', () => {
    seed({ bot: bot('not_connected') });
    renderList('owner');
    expect(screen.getByText('Connect the bot to start receiving messages.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open bot settings' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/bot`,
    );
  });

  it('no bot (needs_token), operator: no link', () => {
    seed({ bot: bot('needs_token') });
    renderList('operator');
    expect(screen.getByText('Ask a business owner to connect the bot.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open bot settings' })).toBeNull();
    expect(screen.queryByText('Connect the bot to start receiving messages.')).toBeNull();
  });
});

describe('SCR-01 notice (AC-14)', () => {
  const text =
    "New customer messages are not arriving in tg-inbox. Another service took over the bot's messages.";

  it('owner sees the notice with the link and the list stays usable', () => {
    seed({ bot: bot('taken_over'), conversations: [conv(1)] });
    renderList('owner');
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('link', { name: 'Open bot settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Name1/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Search conversations')).toBeEnabled();
  });

  it('operator sees the notice with the ask-an-owner text, no link', () => {
    seed({ bot: bot('taken_over'), conversations: [conv(1)] });
    renderList('operator');
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByText('Ask a business owner to reconnect the bot.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open bot settings' })).toBeNull();
  });

  it('is gone when the bot is connected again, and absent for needs_token', () => {
    seed({ bot: bot('taken_over'), conversations: [conv(1)] });
    renderList('owner');
    act(() => seed({ bot: bot('connected'), conversations: [conv(1)] }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => seed({ bot: bot('needs_token'), conversations: [conv(1)] }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SCR-01 search (AC-02)', () => {
  const page = (items: Conversation[], extra = {}) => ({
    workspace_id: WS,
    items,
    has_prev: false,
    has_next: false,
    next_cursor: null,
    ...extra,
  });

  it('debounces, sends the trimmed q, keeps previous rows while in flight, then shows matches', async () => {
    let resolve!: (p: unknown) => void;
    api.listConversations.mockReturnValue(new Promise((r) => (resolve = r)));
    seed({ conversations: [conv(1), conv(2)] });
    renderList();
    const input = screen.getByLabelText('Search conversations');
    expect(input).toHaveAttribute('maxLength', '200');
    fireEvent.change(input, { target: { value: '  Name2 ' } });
    expect(api.listConversations).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(api.listConversations).toHaveBeenCalledTimes(1);
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({ q: 'Name2' });
    expect(screen.getByRole('link', { name: /Name1/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId('conversation-skeleton')).toHaveLength(0);
    await act(async () => resolve(page([conv(2)], { lens: SEARCHING })));
    expect(screen.queryByRole('link', { name: /Name1/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Name2/ })).toBeInTheDocument();
  });

  it('no match: message with Clear search that resets the field and the list', async () => {
    api.listConversations.mockResolvedValue(page([], { lens: SEARCHING }));
    seed({ conversations: [conv(1)] });
    renderList();
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'zzz' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText('No conversations match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(screen.getByRole('link', { name: /Name1/ })).toBeInTheDocument();
    expect(screen.queryByText('No conversations match')).toBeNull();
  });
});

describe('SCR-01 paging', () => {
  const observers: { cb: IntersectionObserverCallback }[] = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          observers.push({ cb });
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });
  const reach = () =>
    act(async () => {
      for (const o of observers)
        o.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

  it('loads the next page by next_cursor and shows 2 skeleton rows meanwhile', async () => {
    let resolve!: (p: unknown) => void;
    api.listConversations.mockReturnValue(new Promise((r) => (resolve = r)));
    seed({ conversations: [conv(1)], hasNext: true, nextCursor: 'abc' });
    renderList();
    await reach();
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({ after: 'abc' });
    expect(screen.getAllByTestId('conversation-skeleton')).toHaveLength(2);
    await act(async () =>
      resolve({
        workspace_id: WS,
        lens: OPEN,
        items: [conv(5)],
        has_prev: false,
        has_next: false,
        next_cursor: null,
      }),
    );
    expect(screen.getByRole('link', { name: /Name5/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId('conversation-skeleton')).toHaveLength(0);
  });

  it('a row fetched again by a later page replaces its stale copy (R1)', async () => {
    seed({ conversations: [conv(1)], hasNext: true, nextCursor: 'abc' });
    renderList();
    const page = (items: Conversation[], next: string | null) => ({
      workspace_id: WS,
      lens: OPEN,
      items,
      has_prev: false,
      has_next: next !== null,
      next_cursor: next,
    });
    api.listConversations.mockResolvedValueOnce(page([conv(5)], 'def'));
    await reach();
    expect(screen.getByRole('link', { name: /hello 5/ })).toBeInTheDocument();
    const reachLast = () =>
      act(async () => {
        observers
          .at(-1)
          ?.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
    api.listConversations.mockResolvedValueOnce(
      page(
        [
          conv(5, { last_item: { type: 'message', id: cid(399), kind: 'text', body: 'fresh 5' } }),
          conv(6),
        ],
        null,
      ),
    );
    await reachLast();
    expect(screen.getByRole('link', { name: /fresh 5/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /hello 5/ })).not.toBeInTheDocument();
  });

  it('a re-read first page restarts paging from its cursor, so a row that slid down shows again (R3)', async () => {
    const page = (items: Conversation[], next: string | null) => ({
      workspace_id: WS,
      lens: OPEN,
      items,
      has_prev: false,
      has_next: next !== null,
      next_cursor: next,
    });
    useInboxStore.getState().leave();
    api.listConversations.mockResolvedValueOnce(page([conv(1), conv(2), conv(3)], 'abc'));
    await act(() => useInboxStore.getState().enter(WS));
    renderList();
    api.listConversations.mockResolvedValueOnce(page([conv(5)], 'def'));
    await reach();
    expect(screen.getByRole('link', { name: /Name5/ })).toBeInTheDocument();
    // Offline, conversation 2 got busier and conversation 3 slid off the first page.
    api.listConversations.mockResolvedValueOnce(
      page([conv(2, { last_activity_at: ago(0) }), conv(1)], 'xyz'),
    );
    await act(async () => live.reconnected!());
    await flush();
    api.listConversations.mockResolvedValueOnce(page([conv(3), conv(5)], null));
    await act(async () => {
      observers
        .at(-1)
        ?.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    const loads = api.listConversations.mock.calls.filter((c) => c[1]?.after);
    expect(loads.at(-1)![1]).toMatchObject({ after: 'xyz' });
    expect(screen.getByRole('link', { name: /Name3/ })).toBeInTheDocument();
  });

  it('error while loading more: message with Retry', async () => {
    api.listConversations.mockRejectedValueOnce(new Error('net'));
    seed({ conversations: [conv(1)], hasNext: true, nextCursor: 'abc' });
    renderList();
    await reach();
    expect(screen.getByText("Couldn't load more conversations")).toBeInTheDocument();
    api.listConversations.mockResolvedValueOnce({
      workspace_id: WS,
      lens: OPEN,
      items: [conv(5)],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByRole('link', { name: /Name5/ })).toBeInTheDocument();
  });
});

describe('SCR-01 search and paging together (W6) and guard answers (W1)', () => {
  const observers: { cb: IntersectionObserverCallback }[] = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          observers.push({ cb });
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });
  // Only the newest observer is live: earlier ones were disconnected on re-render.
  const reach = () =>
    act(async () => {
      observers
        .at(-1)
        ?.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
  const page = (items: Conversation[], extra = {}) => ({
    workspace_id: WS,
    items,
    has_prev: false,
    has_next: false,
    next_cursor: null,
    ...extra,
  });
  const typeSearch = async (text: string) => {
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: text } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
  };

  it('a search started while a page is loading resets paging; the results page further', async () => {
    api.listConversations.mockReturnValueOnce(new Promise(() => undefined)); // load-more hangs
    seed({ conversations: [conv(1)], hasNext: true, nextCursor: 'abc' });
    renderList();
    await reach();
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({ after: 'abc' });
    api.listConversations.mockResolvedValueOnce(
      page([conv(2)], { lens: SEARCHING, has_next: true, next_cursor: 'q1' }),
    );
    await typeSearch('Name2');
    expect(screen.getByRole('link', { name: /Name2/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId('conversation-skeleton')).toHaveLength(0);
    api.listConversations.mockResolvedValueOnce(page([conv(3)], { lens: SEARCHING }));
    await reach();
    expect(api.listConversations).toHaveBeenCalledTimes(3);
    expect(api.listConversations.mock.calls[2]![1]).toMatchObject({ q: 'Name2', after: 'q1' });
    expect(screen.getByRole('link', { name: /Name3/ })).toBeInTheDocument();
  });

  it('a load-more started while a search is in flight does not drop the search answer', async () => {
    let resolveSearch!: (p: unknown) => void;
    seed({ conversations: [conv(1)], hasNext: true, nextCursor: 'abc' });
    renderList();
    api.listConversations.mockReturnValueOnce(new Promise((r) => (resolveSearch = r)));
    await typeSearch('Name2');
    api.listConversations.mockResolvedValueOnce(page([conv(5)]));
    await reach();
    await act(async () => resolveSearch(page([conv(2)], { lens: SEARCHING })));
    expect(screen.getByRole('link', { name: /Name2/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Name1/ })).toBeNull();
  });

  it('a 403 on search is handed to the guard', async () => {
    seed({ conversations: [conv(1)] });
    renderList();
    const removed = new ApiError(403, 'ACCESS_REMOVED' as never, 'removed');
    api.listConversations.mockRejectedValueOnce(removed);
    await typeSearch('Name');
    expect(useInboxStore.getState().guardError).toBe(removed);
  });

  it('a 401 on loading more is handed to the guard', async () => {
    seed({ conversations: [conv(1)], hasNext: true, nextCursor: 'abc' });
    renderList();
    const gone = new ApiError(401, 'UNAUTHENTICATED' as never, 'gone');
    api.listConversations.mockRejectedValueOnce(gone);
    await reach();
    expect(useInboxStore.getState().guardError).toBe(gone);
  });
});

describe('InboxPage', () => {
  it('has the Inbox title and no Sample data label', () => {
    seed({ conversations: [conv(1)] });
    useWorkspaceStore.setState({ current: { id: WS, name: 'Acme', role: 'operator' } });
    render(
      <MemoryRouter initialEntries={[`/w/${WS}/inbox`]}>
        <Routes>
          <Route path="/w/:workspaceId/inbox" element={<InboxPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByText('Sample data')).toBeNull();
  });
});

describe('SCR-01 row assignee line and Closed mark (AC-01)', () => {
  const OLENA = { account_id: cid(900), display_name: 'Olena Kravets' };

  it('shows the assignee name or Unassigned with the user icon, muted', () => {
    seed({ conversations: [conv(1, { assignee: OLENA }), conv(2)] });
    renderList();
    const named = screen.getByRole('link', { name: /Name1/ });
    expect(within(named).getByText('Olena Kravets')).toBeInTheDocument();
    expect(named.querySelector('svg.lucide-user-round')).not.toBeNull();
    const none = screen.getByRole('link', { name: /Name2/ });
    expect(within(none).getByText('Unassigned').closest('p')).toHaveClass('text-muted-foreground');
  });

  it('a change of assignee or status never becomes the preview or the time', () => {
    seed({ conversations: [conv(3, { assignee: OLENA })] });
    renderList();
    const row = screen.getByRole('link', { name: /Name3/ });
    expect(within(row).getByText('hello 3')).toBeInTheDocument();
    expect(within(row).getByText('3m')).toBeInTheDocument();
  });

  it('marks closed rows with an outline Closed badge only while searching', async () => {
    const closed = conv(1, { status: 'closed' });
    api.listConversations.mockResolvedValue({
      workspace_id: WS,
      lens: SEARCHING,
      items: [closed, conv(2)],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    seed({ conversations: [conv(2)], lens: { status: 'open', assignee: 'all' } });
    renderList();
    expect(screen.queryByText('Closed', { selector: '[data-slot="badge"]' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'na' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    const badge = within(screen.getByRole('link', { name: /Name1/ })).getByText('Closed');
    expect(badge).toHaveAttribute('data-variant', 'outline');
    expect(within(screen.getByRole('link', { name: /Name2/ })).queryByText('Closed')).toBeNull();
  });
});

describe('SCR-01 loaded pages and search results follow live changes (W3, W4, W7)', () => {
  const observers: { cb: IntersectionObserverCallback }[] = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          observers.push({ cb });
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    useInboxStore.getState().leave();
  });
  const reach = () =>
    act(async () => {
      observers
        .at(-1)
        ?.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
  const page = (items: Conversation[], extra = {}) => ({
    workspace_id: WS,
    lens: OPEN,
    items,
    has_prev: false,
    has_next: false,
    next_cursor: null,
    ...extra,
  });
  const summaryOf = (c: Conversation, over: Partial<Conversation> = {}) => ({
    ...c,
    close_snapshot: { customer_message_seq: 1, latest_reply: null },
    ...over,
  });
  const stateFrame = (c: Conversation) =>
    act(async () =>
      live.frame!({
        v: 1,
        workspace_id: WS,
        type: 'conversation.changed',
        conversation_id: c.id,
        item: null,
        change: 'state',
      }),
    );
  const OLENA = { account_id: cid(950), display_name: 'Olena Kravets' };

  it('a row on a later page leaves the Open lens when it is closed live', async () => {
    api.listConversations.mockResolvedValueOnce(
      page([conv(1)], { has_next: true, next_cursor: 'abc' }),
    );
    await act(() => useInboxStore.getState().enter(WS));
    renderList();
    api.listConversations.mockResolvedValueOnce(page([conv(5)]));
    await reach();
    expect(screen.getByRole('link', { name: /Name5/ })).toBeInTheDocument();
    api.getConversation.mockResolvedValue(
      summaryOf(conv(5), { status: 'closed', state_version: 1 }),
    );
    await stateFrame(conv(5));
    await flush();
    expect(screen.queryByRole('link', { name: /Name5/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Name1/ })).toBeInTheDocument();
  });

  it('a search result shows a live assignment and close (assignee line, Closed mark)', async () => {
    api.listConversations.mockResolvedValueOnce(page([conv(1), conv(2)]));
    await act(() => useInboxStore.getState().enter(WS));
    renderList();
    api.listConversations.mockResolvedValueOnce(page([conv(2)], { lens: SEARCHING }));
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'Name2' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    const link = () => screen.getByRole('link', { name: /Name2/ });
    expect(within(link()).getByText('Unassigned')).toBeInTheDocument();
    api.getConversation.mockResolvedValue(
      summaryOf(conv(2), { status: 'closed', assignee: OLENA, state_version: 1 }),
    );
    await stateFrame(conv(2));
    await flush();
    expect(within(link()).getByText('Olena Kravets')).toBeInTheDocument();
    expect(link().querySelector('[data-slot="badge"]')).toHaveTextContent('Closed');
    expect(screen.queryByRole('link', { name: /Name1/ })).toBeNull();
  });

  it('a resync re-runs the search on screen', async () => {
    api.listConversations.mockResolvedValueOnce(page([conv(1), conv(2)]));
    await act(() => useInboxStore.getState().enter(WS));
    renderList();
    api.listConversations.mockResolvedValueOnce(page([conv(2)], { lens: SEARCHING }));
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'Name2' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    api.listConversations.mockImplementation(async (_ws: string, params: { q?: string }) =>
      params.q ? page([conv(2), conv(3)], { lens: SEARCHING }) : page([conv(1), conv(2)]),
    );
    await act(async () => live.frame!({ v: 1, workspace_id: WS, type: 'resync' }));
    await flush();
    expect(screen.getByRole('link', { name: /Name3/ })).toBeInTheDocument();
  });

  it('Retry after a failed first page keeps the open thread (W7)', async () => {
    api.listConversations.mockResolvedValue(page([conv(1)]));
    seed({
      listStatus: 'error',
      thread: {
        conversationId: conv(1).id,
        status: 'ready',
        contact: conv(1).contact,
        summary: null,
        older: 'idle',
        items: [],
        hasPrev: false,
        prevCursor: null,
        readThroughAt: null,
      },
    });
    renderList('operator', `/w/${WS}/inbox`);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(useInboxStore.getState().listStatus).toBe('ready');
    expect(useInboxStore.getState().thread).toMatchObject({
      conversationId: conv(1).id,
      status: 'ready',
    });
  });
});
