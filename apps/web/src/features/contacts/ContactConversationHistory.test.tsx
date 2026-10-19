import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type ContactProfile as ContactProfileDto,
  type ConversationSummary,
  type LiveFrame,
  type ThreadActivity,
  type ThreadMessage,
  type ThreadPage,
  type ThreadReply,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useInboxStore } from '@/features/inbox/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getContact: vi.fn(),
  listContactTagHistory: vi.fn(),
  getContactConversation: vi.fn(),
  listThreadItems: vi.fn(),
  markConversationRead: vi.fn(),
  sendReply: vi.fn(),
  resendReply: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getContact: (...a: unknown[]) => api.getContact(...a),
  listContactTagHistory: (...a: unknown[]) => api.listContactTagHistory(...a),
  getContactConversation: (...a: unknown[]) => api.getContactConversation(...a),
}));
vi.mock('@/features/inbox/api-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/api-source')>()),
  listThreadItems: (...a: unknown[]) => api.listThreadItems(...a),
  markConversationRead: (...a: unknown[]) => api.markConversationRead(...a),
  sendReply: (...a: unknown[]) => api.sendReply(...a),
  resendReply: (...a: unknown[]) => api.resendReply(...a),
}));
const live = vi.hoisted(() => ({
  subs: [] as { workspaceId: string; subscriber: Record<string, (...a: never[]) => void> }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: (workspaceId: string, subscriber: Record<string, (...a: never[]) => void>) => {
    const entry = { workspaceId, subscriber };
    live.subs.push(entry);
    return () => {
      live.subs = live.subs.filter((e) => e !== entry);
    };
  },
}));

import { ContactProfile } from './ContactProfile';
import { useContactsStore } from './store';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const C1 = '0198f0c0-0000-7000-8000-000000000901';
const CONV = '0198f0c0-0000-7000-8000-000000000101';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 10, min)).toISOString();
const guard = vi.fn();
const settle = () => new Promise((r) => setTimeout(r, 0));

const contact: ContactProfileDto = {
  id: C1,
  workspace_id: WS,
  first_name: 'Ada',
  last_name: 'Lovelace',
  username: 'ada',
  language_code: 'uk',
  first_wrote_at: at(0),
  last_wrote_at: at(5),
  tags: [],
};
const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: CONV,
  workspace_id: WS,
  contact: { id: C1, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
  last_activity_at: at(5),
  last_item: { type: 'message', id: id(500), kind: 'text', body: 'hi' },
  unread_count: 2,
  waiting_for_reply: true,
  status: 'open',
  assignee: null,
  state_version: 1,
  close_snapshot: { customer_message_seq: 1, latest_reply: null },
  ...over,
});
const message = (n: number, min: number, over: Partial<ThreadMessage> = {}): ThreadMessage =>
  ({
    type: 'message',
    id: id(500 + n),
    workspace_id: WS,
    conversation_id: CONV,
    kind: 'text',
    body: `customer says ${n}`,
    sent_at: at(min),
    received_at: at(min),
    edited_at: null,
    attachment: null,
    location: null,
    contact: null,
    poll: null,
    ...over,
  }) as unknown as ThreadMessage;
const reply = (n: number, min: number, over: Partial<ThreadReply> = {}): ThreadReply => ({
  type: 'reply',
  id: id(600 + n),
  workspace_id: WS,
  conversation_id: CONV,
  client_key: id(650 + n),
  body: `team says ${n}`,
  author: { account_id: id(802), display_name: 'Test User 2' },
  state: 'sent',
  failure_reason: null,
  position_at: at(min),
  sent_at: at(min),
  created_at: at(min),
  ...over,
});
const activity = (n: number, min: number): ThreadActivity =>
  ({
    type: 'activity',
    id: id(700 + n),
    workspace_id: WS,
    conversation_id: CONV,
    kind: 'assigned',
    cause: 'member',
    actor: { account_id: id(800), display_name: 'Test User' },
    previous_assignee: null,
    new_assignee: { account_id: id(802), display_name: 'Test User 2' },
    position_at: at(min),
  }) as unknown as ThreadActivity;
const page = (items: ThreadPage['items'], over: Partial<ThreadPage> = {}): ThreadPage => ({
  workspace_id: WS,
  conversation_id: CONV,
  items,
  has_prev: false,
  has_next: false,
  prev_cursor: null,
  next_cursor: null,
  read_through_at: null,
  newest_reply_id: null,
  ...over,
});

function renderProfile() {
  useWorkspaceStore.setState({ current: { id: WS, name: 'Acme Flowers', role: 'operator' } });
  return render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <ContactProfile workspaceId={WS} contactId={C1} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );
}
const emit = (f: Record<string, unknown>) => {
  for (const s of live.subs)
    (s.subscriber.onFrame as (f: LiveFrame) => void)({ v: 1, workspace_id: WS, ...f } as LiveFrame);
};
const scroller = () => screen.getByTestId('history-scroll');
const bubbles = () => screen.getAllByTestId('bubble').map((b) => b.textContent ?? '');

beforeEach(() => {
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  api.getContact.mockResolvedValue(contact);
  api.listContactTagHistory.mockResolvedValue({
    workspace_id: WS,
    contact_id: C1,
    items: [],
    has_prev: false,
    has_next: false,
    next_cursor: null,
  });
  api.getContactConversation.mockResolvedValue(summary());
  api.listThreadItems.mockResolvedValue(
    page([message(1, 1), activity(1, 2), reply(1, 3, { state: 'sent' }), message(2, 4)]),
  );
  useContactsStore.getState().clear();
  useInboxStore.setState({ bot: null, guardError: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Conversation tab: the history', () => {
  it('shows the items in inbox order: customer bubbles, the team reply with author and state, the activity line', async () => {
    renderProfile();
    await screen.findByText('customer says 1');
    expect(screen.getByText('Start of the conversation')).toBeInTheDocument();
    const order = screen
      .getAllByText(/customer says|team says|assigned this to/)
      .map((n) => n.textContent);
    expect(order[0]).toBe('customer says 1');
    expect(order[1]).toMatch(/Test User assigned this to Test User 2/);
    expect(order[2]).toBe('team says 1');
    expect(order[3]).toBe('customer says 2');
    const replyBubble = screen
      .getByText('team says 1')
      .closest('[data-testid="bubble"]') as HTMLElement;
    expect(within(replyBubble).getByText('Test User 2')).toBeInTheDocument();
    expect(within(replyBubble).getByText('Sent')).toBeInTheDocument();
    expect(screen.getAllByTestId('activity-line')).toHaveLength(1);
  });

  it('shows four bubble skeletons while the conversation loads', () => {
    api.getContactConversation.mockReturnValue(new Promise(() => undefined));
    renderProfile();
    expect(screen.getAllByTestId('bubble-skeleton')).toHaveLength(4);
  });

  it('is scrolled to the end when opened', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
    renderProfile();
    await screen.findByText('customer says 2');
    await waitFor(() => expect(scroller().scrollTop).toBe(900));
  });

  it('says «No messages to show» when there is no item', async () => {
    api.listThreadItems.mockResolvedValue(page([]));
    renderProfile();
    expect(await screen.findByText('No messages to show')).toBeInTheDocument();
  });

  it('says «No conversation to show» in the tab when the contact has none', async () => {
    api.getContactConversation.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    renderProfile();
    const tab = await screen.findByTestId('history-scroll-none');
    expect(within(tab).getByText('No conversation to show')).toBeInTheDocument();
  });

  it("shows «Couldn't load the conversation» with Retry in the tab when the summary fails, and again when the first items fail", async () => {
    api.getContactConversation.mockRejectedValueOnce(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'),
    );
    renderProfile();
    const failed = await screen.findByTestId('history-error');
    expect(within(failed).getByText("Couldn't load the conversation")).toBeInTheDocument();
    api.getContactConversation.mockResolvedValueOnce(summary());
    api.listThreadItems.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }));
    const again = await screen.findByTestId('history-error');
    expect(within(again).getByText("Couldn't load the conversation")).toBeInTheDocument();
    api.getContactConversation.mockResolvedValueOnce(summary());
    api.listThreadItems.mockResolvedValueOnce(page([message(1, 1)]));
    fireEvent.click(within(again).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('customer says 1')).toBeInTheDocument();
  });
});

describe('Conversation tab: older pages', () => {
  const withOlder = () =>
    api.listThreadItems.mockResolvedValue(
      page([message(3, 3), message(4, 4)], { has_prev: true, prev_cursor: 'p1' }),
    );

  it('loads the previous page by before when scrolled to the top, with a skeleton on top while it loads', async () => {
    withOlder();
    renderProfile();
    await screen.findByText('customer says 3');
    expect(screen.queryByText('Start of the conversation')).not.toBeInTheDocument();
    let done!: (p: ThreadPage) => void;
    api.listThreadItems.mockReturnValueOnce(new Promise((r) => (done = r)));
    scroller().scrollTop = 0;
    fireEvent.scroll(scroller());
    expect(api.listThreadItems).toHaveBeenLastCalledWith(WS, CONV, { before: 'p1', limit: 30 });
    expect(await screen.findByTestId('older-loading')).toBeInTheDocument();
    await act(async () => done(page([message(1, 1), message(2, 2)])));
    await waitFor(() => expect(screen.queryByTestId('older-loading')).not.toBeInTheDocument());
    expect(screen.getByText('customer says 1')).toBeInTheDocument();
    expect(screen.getByText('Start of the conversation')).toBeInTheDocument();
  });

  it("shows «Couldn't load earlier messages» with Retry and keeps what is shown", async () => {
    withOlder();
    renderProfile();
    await screen.findByText('customer says 3');
    api.listThreadItems.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    scroller().scrollTop = 0;
    fireEvent.scroll(scroller());
    expect(await screen.findByText("Couldn't load earlier messages")).toBeInTheDocument();
    expect(screen.getByText('customer says 3')).toBeInTheDocument();
    api.listThreadItems.mockResolvedValueOnce(page([message(1, 1), message(2, 2)]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('customer says 1')).toBeInTheDocument();
  });
});

describe('Conversation tab: media', () => {
  it('opens a photo in the viewer over the profile and closes it back to the profile', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(new Blob(['x'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/1');
    URL.revokeObjectURL = vi.fn();
    api.listThreadItems.mockResolvedValue(
      page([
        message(1, 1, {
          kind: 'photo',
          body: 'a tulip',
          attachment: { mime_type: 'image/jpeg' },
        } as never),
      ]),
    );
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo' }));
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/api/workspaces/${WS}/inbox/conversations/${CONV}/messages/${id(501)}/media`,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeInTheDocument();
  });
});

describe('Conversation tab: the guard of the profile, not the inbox', () => {
  it('a media 401 / 403 is handed to the shell guard, and nothing is left for the inbox page', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'ACCESS_REMOVED', message: 'Access removed' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useInboxStore.setState({ workspaceId: WS, guardError: null });
    api.listThreadItems.mockResolvedValue(
      page([
        message(1, 1, {
          kind: 'photo',
          body: 'a tulip',
          attachment: { mime_type: 'image/jpeg' },
        } as never),
      ]),
    );
    renderProfile();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(guard).toHaveBeenCalled());
    expect(guard.mock.calls.at(-1)![0]).toMatchObject({
      status: 403,
      code: ErrorCode.ACCESS_REMOVED,
    });
    expect(guard.mock.calls.at(-1)![1]).toBe(WS);
    expect(useInboxStore.getState().guardError).toBeNull();
  });

  it("a failed reply shows no «not arriving» warning from the inbox's bot status", async () => {
    useInboxStore.setState({
      bot: { workspace_id: WS, state: 'taken_over', can_reply: true, receiving: false },
    });
    api.listThreadItems.mockResolvedValue(
      page([reply(1, 3, { state: 'not_delivered', failure_reason: 'delivery_interrupted' })]),
    );
    renderProfile();
    expect(await screen.findByText('Not delivered — sending was interrupted')).toBeInTheDocument();
    expect(screen.queryByText('New customer messages are not arriving')).not.toBeInTheDocument();
  });
});

describe('Conversation tab: live and read-only', () => {
  it('appends a new customer message at the bottom without reloading, and nothing is marked read', async () => {
    renderProfile();
    await screen.findByText('customer says 2');
    api.listThreadItems.mockResolvedValue(
      page([message(1, 1), activity(1, 2), reply(1, 3), message(2, 4), message(3, 5)]),
    );
    act(() =>
      emit({
        type: 'conversation.changed',
        conversation_id: CONV,
        item: { type: 'message', id: id(503) },
        change: 'created',
      }),
    );
    expect(await screen.findByText('customer says 3')).toBeInTheDocument();
    const texts = bubbles();
    expect(texts.at(-1)).toContain('customer says 3');
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('follows the new item only when the view was at the bottom', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    renderProfile();
    await screen.findByText('customer says 2');
    await waitFor(() => expect(scroller().scrollTop).toBe(900));
    // scrolled up reading older text: a new item does not pull the view down
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    api.listThreadItems.mockResolvedValue(
      page([message(1, 1), activity(1, 2), reply(1, 3), message(2, 4), message(3, 5)]),
    );
    act(() =>
      emit({
        type: 'conversation.changed',
        conversation_id: CONV,
        item: { type: 'message', id: id(503) },
        change: 'created',
      }),
    );
    await screen.findByText('customer says 3');
    expect(scroller().scrollTop).toBe(100);
  });

  it('has no composer and no reply box, and no mark-read request while the tab is visible', async () => {
    renderProfile();
    await screen.findByText('customer says 2');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(api.markConversationRead).not.toHaveBeenCalled();
    expect(api.sendReply).not.toHaveBeenCalled();
  });

  it("shows a failed reply's state with no resend buttons", async () => {
    api.listThreadItems.mockResolvedValue(
      page([
        reply(1, 3, {
          state: 'not_delivered',
          failure_reason: 'delivery_interrupted',
          sent_at: null,
        }),
        reply(2, 4, { state: 'not_confirmed', sent_at: null }),
      ]),
    );
    renderProfile();
    expect(await screen.findByText('Not delivered — sending was interrupted')).toBeInTheDocument();
    expect(
      screen.getByText('Not confirmed — it may or may not have reached the customer'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
    expect(api.resendReply).not.toHaveBeenCalled();
  });
});
