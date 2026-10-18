import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ThreadMessage, ThreadPage, ThreadReply } from '@tg/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';

const api = {
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listThreadItems: vi.fn(),
  getThreadMessage: vi.fn(),
  getThreadReply: vi.fn(),
  markConversationRead: vi.fn(),
  getInboxBotStatus: vi.fn(),
  sendReply: vi.fn(),
};
vi.mock('./api-source', () => ({
  listConversations: (...a: unknown[]) => api.listConversations(...a),
  getConversation: (...a: unknown[]) => api.getConversation(...a),
  listThreadItems: (...a: unknown[]) => api.listThreadItems(...a),
  getThreadMessage: (...a: unknown[]) => api.getThreadMessage(...a),
  getThreadReply: (...a: unknown[]) => api.getThreadReply(...a),
  markConversationRead: (...a: unknown[]) => api.markConversationRead(...a),
  getInboxBotStatus: (...a: unknown[]) => api.getInboxBotStatus(...a),
  sendReply: (...a: unknown[]) => api.sendReply(...a),
}));

interface Handlers {
  onFrame: (f: unknown) => void;
}
const sockets: { handlers: Handlers }[] = [];
vi.mock('@/shared/api/realtime', () => ({
  openLiveSocket: (_ws: string, handlers: Handlers) => {
    const s = { handlers, close: vi.fn() };
    sockets.push(s);
    return s;
  },
}));

import { ConversationCrumb } from './ConversationCrumb';
import { InboxList } from './InboxList';
import { useInboxStore } from './store';
import { Thread } from './Thread';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const CONV = '0198f0c0-0000-7000-8000-000000000101';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 10, min)).toISOString();

const summary = (over = {}) => ({
  id: CONV,
  workspace_id: WS,
  contact: { id: id(900), first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
  last_activity_at: at(5),
  last_item: { type: 'message', id: id(500), kind: 'text', body: 'hi' },
  unread_count: 0,
  waiting_for_reply: false,
  ...over,
});
const message = (n: number, min: number, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  type: 'message',
  id: id(500 + n),
  workspace_id: WS,
  conversation_id: CONV,
  kind: 'text',
  body: `customer ${n}`,
  sent_at: at(min),
  received_at: at(min),
  edited_at: null,
  attachment: null,
  location: null,
  shared_contact: null,
  poll: null,
  ...over,
});
const reply = (n: number, min: number, over: Partial<ThreadReply> = {}): ThreadReply => ({
  type: 'reply',
  id: id(700 + n),
  workspace_id: WS,
  conversation_id: CONV,
  client_key: id(800 + n),
  body: `team ${n}`,
  author: { account_id: id(950), display_name: 'Olena Operator' },
  state: 'sent',
  failure_reason: null,
  position_at: at(min),
  sent_at: at(min),
  created_at: at(min),
  ...over,
});
const page = (items: ThreadPage['items'], over: Partial<ThreadPage> = {}): ThreadPage => ({
  workspace_id: WS,
  conversation_id: CONV,
  items,
  has_prev: false,
  has_next: false,
  prev_cursor: null,
  next_cursor: null,
  read_through_at: at(5),
  ...over,
});
const changed = (change: string, item: unknown) => ({
  v: 1,
  workspace_id: WS,
  type: 'conversation.changed',
  conversation_id: CONV,
  item,
  change,
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => Promise.resolve());
};
const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

function renderThread(path = `/w/${WS}/inbox/${CONV}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId/inbox/:conversationId" element={<Thread />} />
        <Route path="/w/:workspaceId/inbox" element={<p>list route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openAndRender(items: ThreadPage['items'], over: Partial<ThreadPage> = {}) {
  api.listThreadItems.mockResolvedValue(page(items, over));
  const view = renderThread();
  await flush();
  return view;
}

const texts = () =>
  Array.from(document.querySelectorAll('[data-testid="bubble"]')).map((b) => b.textContent ?? '');

beforeEach(async () => {
  vi.resetAllMocks();
  sockets.length = 0;
  setVisibility('visible');
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  useWorkspaceStore.getState().clear();
  useInboxStore.getState().leave();
  api.listConversations.mockResolvedValue({
    workspace_id: WS,
    items: [],
    has_prev: false,
    has_next: false,
    next_cursor: null,
  });
  api.getInboxBotStatus.mockResolvedValue({
    workspace_id: WS,
    state: 'connected',
    can_reply: true,
    receiving: true,
  });
  api.getConversation.mockResolvedValue(summary());
  api.markConversationRead.mockResolvedValue({});
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  await useInboxStore.getState().enter(WS);
});

describe('SCR-02 default (AC-03)', () => {
  it('shows the contact header and the history oldest-first with reply authors', async () => {
    await openAndRender([message(1, 1), reply(1, 2), message(2, 3)]);
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('@ada')).toBeInTheDocument();
    expect(texts().map((t) => t.match(/customer \d|team \d/)?.[0])).toEqual([
      'customer 1',
      'team 1',
      'customer 2',
    ]);
    expect(screen.getByText('Olena Operator')).toBeInTheDocument();
    expect(api.listThreadItems).toHaveBeenCalledWith(
      WS,
      CONV,
      expect.objectContaining({ limit: expect.any(Number) }),
      {},
    );
  });

  it('puts customer messages left and team replies right', async () => {
    await openAndRender([message(1, 1), reply(1, 2)]);
    const [customer, team] = Array.from(document.querySelectorAll('[data-testid="bubble"]'));
    expect(customer!.parentElement).toHaveClass('justify-start');
    expect(team!.parentElement).toHaveClass('justify-end');
  });

  it('renders customer text as plain text, not HTML', async () => {
    await openAndRender([message(1, 1, { body: '<b>bold</b>' })]);
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  });

  it('shows a non-text message through MessageContent (kind, caption, unavailable reason)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'MEDIA_UNAVAILABLE', message: 'x', details: { reason: 'file_gone' } },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );
    await openAndRender([
      message(1, 1, {
        kind: 'photo',
        body: 'new bouquet?',
        attachment: { file_name: null, mime_type: 'image/jpeg', file_size: 5 },
      }),
      message(2, 2),
    ]);
    expect(
      await screen.findByText('Content unavailable — Telegram no longer keeps this file'),
    ).toBeInTheDocument();
    expect(screen.getByText('new bouquet?')).toBeInTheDocument();
    expect(screen.getByText('customer 2')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows no @username when the contact has none', async () => {
    api.getConversation.mockResolvedValue(
      summary({ contact: { id: id(900), first_name: 'Ada', last_name: null, username: null } }),
    );
    await openAndRender([message(1, 1)]);
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.queryByText(/^@/)).toBeNull();
  });
});

describe('SCR-02 loading and errors', () => {
  it('loading: header skeleton and four bubble skeletons', async () => {
    api.listThreadItems.mockReturnValue(new Promise(() => {}));
    renderThread();
    await flush();
    expect(screen.getByTestId('thread-loading')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="bubble-skeleton"]')).toHaveLength(4);
  });

  it('error: Something went wrong with Retry that reloads', async () => {
    api.listThreadItems.mockRejectedValueOnce(new Error('boom'));
    renderThread();
    await flush();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    api.listThreadItems.mockResolvedValue(page([message(1, 1)]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByText('customer 1')).toBeInTheDocument();
  });

  it('error: a summary failure (not 404) with no known contact shows the error with Retry (W2)', async () => {
    api.getConversation.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR' as never, 'boom'));
    api.listThreadItems.mockResolvedValue(page([message(1, 1)]));
    renderThread();
    await flush();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByTestId('thread-loading')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('customer 1')).toBeInTheDocument();
  });

  it('a summary failure while the contact is known from the list row keeps the thread', async () => {
    api.listConversations.mockResolvedValue({
      workspace_id: WS,
      items: [summary()],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    useInboxStore.getState().leave();
    await useInboxStore.getState().enter(WS);
    api.getConversation.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR' as never, 'boom'));
    await openAndRender([message(1, 1)]);
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });

  it('not found: a 404 shows the not-found card without a hint', async () => {
    const notFound = new ApiError(404, 'NOT_FOUND' as never, 'nope');
    api.getConversation.mockRejectedValue(notFound);
    api.listThreadItems.mockRejectedValue(notFound);
    renderThread();
    await flush();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});

describe('SCR-02 paging up', () => {
  const older = [message(10, 0)];

  it('loads the page before prev_cursor above, then shows start of history', async () => {
    await openAndRender([message(1, 1)], { has_prev: true, prev_cursor: 'cur-1' });
    expect(screen.queryByText('Start of the conversation')).toBeNull();
    api.listThreadItems.mockResolvedValue(page(older, { has_prev: false, prev_cursor: null }));
    const scroller = screen.getByTestId('thread-scroll');
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    await flush();
    expect(api.listThreadItems).toHaveBeenLastCalledWith(
      WS,
      CONV,
      expect.objectContaining({ before: 'cur-1' }),
      {},
    );
    expect(screen.getAllByText(/^customer \d+$/).map((e) => e.textContent)).toEqual([
      'customer 10',
      'customer 1',
    ]);
    expect(screen.getByText('Start of the conversation')).toBeInTheDocument();
  });

  it('shows a skeleton above while the older page is in flight', async () => {
    await openAndRender([message(1, 1)], { has_prev: true, prev_cursor: 'cur-1' });
    api.listThreadItems.mockReturnValue(new Promise(() => {}));
    fireEvent.scroll(screen.getByTestId('thread-scroll'));
    await flush();
    expect(screen.getByTestId('older-loading')).toBeInTheDocument();
  });

  it('keeps the reader on the same item after older history is added', async () => {
    await openAndRender([message(1, 1)], { has_prev: true, prev_cursor: 'cur-1' });
    const scroller = screen.getByTestId('thread-scroll');
    let height = 500;
    Object.defineProperty(scroller, 'scrollHeight', { get: () => height, configurable: true });
    scroller.scrollTop = 0;
    api.listThreadItems.mockImplementation(async () => {
      height = 900;
      return page(older, { has_prev: false });
    });
    fireEvent.scroll(scroller);
    await flush();
    expect(scroller.scrollTop).toBe(400);
  });

  it('older page failure: message with Retry; the thread stays readable', async () => {
    await openAndRender([message(1, 1)], { has_prev: true, prev_cursor: 'cur-1' });
    api.listThreadItems.mockRejectedValueOnce(new Error('x'));
    fireEvent.scroll(screen.getByTestId('thread-scroll'));
    await flush();
    expect(screen.getByText("Couldn't load earlier messages")).toBeInTheDocument();
    expect(screen.getByText('customer 1')).toBeInTheDocument();
    api.listThreadItems.mockResolvedValue(page(older));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByText('customer 10')).toBeInTheDocument();
  });
});

describe('SCR-02 marking read (AC-03, AC-15)', () => {
  it('visible tab: marks read through the page read_through_at on open', async () => {
    await openAndRender([message(1, 1)], { read_through_at: at(5) });
    expect(api.markConversationRead).toHaveBeenCalledWith(WS, CONV, at(5), { background: true });
  });

  it('background tab: nothing is marked; on becoming visible, through the newest arrival shown', async () => {
    setVisibility('hidden');
    await openAndRender([message(1, 1), message(2, 9)], { read_through_at: at(5) });
    expect(api.markConversationRead).not.toHaveBeenCalled();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);
    expect(api.markConversationRead).toHaveBeenCalledWith(WS, CONV, at(9), { background: true });
  });

  it('does not mark read again when nothing newer arrived', async () => {
    await openAndRender([message(1, 1)], { read_through_at: at(1) });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);
  });
});

describe('SCR-02 live (AC-15)', () => {
  it('a customer message is placed and read-marked when the tab is visible', async () => {
    await openAndRender([message(1, 1)]);
    api.markConversationRead.mockClear();
    api.getThreadMessage.mockResolvedValue(message(2, 8));
    act(() => sockets[0]!.handlers.onFrame(changed('created', { type: 'message', id: id(502) })));
    await flush();
    expect(screen.getByText('customer 2')).toBeInTheDocument();
    expect(api.markConversationRead).toHaveBeenCalledWith(WS, CONV, at(8), { background: true });
  });

  it('a late redelivery is inserted at its place, not at the end', async () => {
    await openAndRender([message(1, 1), message(3, 9)]);
    api.getThreadMessage.mockResolvedValue(message(2, 4, { received_at: at(12) }));
    act(() => sockets[0]!.handlers.onFrame(changed('created', { type: 'message', id: id(502) })));
    await flush();
    expect(texts().map((t) => t.match(/customer \d/)?.[0])).toEqual([
      'customer 1',
      'customer 2',
      'customer 3',
    ]);
  });

  it('a late redelivery older than the oldest loaded item waits for its page', async () => {
    await openAndRender([message(3, 9)], { has_prev: true, prev_cursor: 'c' });
    api.getThreadMessage.mockResolvedValue(message(2, 4));
    act(() => sockets[0]!.handlers.onFrame(changed('created', { type: 'message', id: id(502) })));
    await flush();
    expect(screen.queryByText('customer 2')).toBeNull();
  });

  it('an edited message shows the new text with «edited» and no read mark', async () => {
    await openAndRender([message(1, 1)]);
    api.markConversationRead.mockClear();
    api.getThreadMessage.mockResolvedValue(message(1, 1, { body: 'new text', edited_at: at(7) }));
    act(() => sockets[0]!.handlers.onFrame(changed('edited', { type: 'message', id: id(501) })));
    await flush();
    const bubble = screen.getByText('new text').closest('[data-testid="bubble"]') as HTMLElement;
    expect(within(bubble).getByText('edited')).toBeInTheDocument();
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('a teammate reply appears with their name', async () => {
    await openAndRender([message(1, 1)]);
    api.getThreadReply.mockResolvedValue(
      reply(2, 6, { author: { account_id: id(951), display_name: 'Pavlo Peer' } }),
    );
    act(() => sockets[0]!.handlers.onFrame(changed('created', { type: 'reply', id: id(702) })));
    await flush();
    expect(screen.getByText('Pavlo Peer')).toBeInTheDocument();
    expect(screen.getByText('team 2')).toBeInTheDocument();
  });

  it('follows a new message only when already at the bottom', async () => {
    await openAndRender([message(1, 1)]);
    const scroller = screen.getByTestId('thread-scroll');
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true });
    api.getThreadMessage.mockResolvedValue(message(2, 8));

    scroller.scrollTop = 100; // reading older text
    fireEvent.scroll(scroller);
    act(() => sockets[0]!.handlers.onFrame(changed('created', { type: 'message', id: id(502) })));
    await flush();
    expect(scroller.scrollTop).toBe(100);

    scroller.scrollTop = 700; // at the bottom
    fireEvent.scroll(scroller);
    api.getThreadMessage.mockResolvedValue(message(3, 9));
    act(() => sockets[0]!.handlers.onFrame(changed('created', { type: 'message', id: id(503) })));
    await flush();
    expect(scroller.scrollTop).toBe(1000);
  });
});

describe('SCR-02 breadcrumb contact', () => {
  it('stores the contact so the breadcrumb can show the name', async () => {
    await openAndRender([message(1, 1)]);
    await waitFor(() =>
      expect(useInboxStore.getState().thread?.contact).toMatchObject({ first_name: 'Ada' }),
    );
  });

  it('the breadcrumb label is the contact name once known, «Conversation» before', async () => {
    const view = render(<ConversationCrumb params={{ conversationId: CONV }} />);
    expect(view.container).toHaveTextContent('Conversation');
    await openAndRender([message(1, 1)]);
    expect(view.container).toHaveTextContent('Ada Lovelace');
  });
});

describe('SCR-02 phone layout', () => {
  it('shows only the thread with Back to conversations; the back link returns to the list', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    api.listThreadItems.mockResolvedValue(page([message(1, 1)]));
    render(
      <MemoryRouter initialEntries={[`/w/${WS}/inbox/${CONV}`]}>
        <Routes>
          <Route path="/w/:workspaceId/inbox/:conversationId?" element={<InboxList />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    expect(screen.queryByLabelText('Search conversations')).toBeNull();
    const back = screen.getByRole('link', { name: 'Back to conversations' });
    expect(back).toHaveAttribute('href', `/w/${WS}/inbox`);
    fireEvent.click(back);
    await flush();
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
  });

  it('desktop: list and thread side by side, no back control', async () => {
    api.listThreadItems.mockResolvedValue(page([message(1, 1)]));
    render(
      <MemoryRouter initialEntries={[`/w/${WS}/inbox/${CONV}`]}>
        <Routes>
          <Route path="/w/:workspaceId/inbox/:conversationId?" element={<InboxList />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
    expect(screen.getByText('customer 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to conversations' })).toBeNull();
  });
});

describe('SCR-02 reply composer (AC-06)', () => {
  it('sits at the bottom of a ready thread, without the preview note', async () => {
    await openAndRender([message(1, 1)]);
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.queryByText(/nothing is sent to customers/)).not.toBeInTheDocument();
  });

  it('is shown disabled while the thread loads (screens.md SCR-02 loading)', () => {
    api.listThreadItems.mockReturnValue(new Promise(() => undefined));
    renderThread();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Send$/ })).toBeDisabled();
  });
});
