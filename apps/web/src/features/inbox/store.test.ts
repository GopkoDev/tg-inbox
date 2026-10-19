import type {
  Conversation,
  ConversationSummary,
  InboxBotStatus,
  ThreadActivity,
  ThreadMessage,
  ThreadPage,
} from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { useAuthStore } from '@/features/auth/store';
import { ApiError } from '@/shared/api/client';

const api = {
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listThreadItems: vi.fn(),
  getThreadMessage: vi.fn(),
  getThreadReply: vi.fn(),
  markConversationRead: vi.fn(),
  getInboxBotStatus: vi.fn(),
  sendReply: vi.fn(),
  getThreadActivity: vi.fn(),
  assignConversation: vi.fn(),
  unassignConversation: vi.fn(),
  closeConversation: vi.fn(),
  reopenConversation: vi.fn(),
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
  getThreadActivity: (...a: unknown[]) => api.getThreadActivity(...a),
  assignConversation: (...a: unknown[]) => api.assignConversation(...a),
  unassignConversation: (...a: unknown[]) => api.unassignConversation(...a),
  closeConversation: (...a: unknown[]) => api.closeConversation(...a),
  reopenConversation: (...a: unknown[]) => api.reopenConversation(...a),
}));

interface Handlers {
  onFrame: (f: unknown) => void;
  onReconnected: () => void;
  onClosed: (code: number) => void;
  onInvalidFrame: () => void;
}
const sockets: { workspaceId: string; handlers: Handlers; close: ReturnType<typeof vi.fn> }[] = [];
vi.mock('@/shared/api/live-connection', () => ({
  liveStatus: () => 'idle',
  subscribeLive: (workspaceId: string, handlers: Handlers) => {
    const s = { workspaceId, handlers, close: vi.fn() };
    sockets.push(s);
    return s.close;
  },
}));

import { useInboxStore } from './store';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const A = id(1);
const B = id(2);
const C1 = id(101);
const C2 = id(102);
const ME = id(7);
const PEER = id(8);

const conv = (
  ws: string,
  cid: string,
  at: string,
  over: Partial<Conversation> = {},
): Conversation => ({
  id: cid,
  workspace_id: ws,
  contact: { id: id(900), first_name: 'Ada', last_name: null, username: null },
  last_activity_at: at,
  last_item: { type: 'message', id: id(500), kind: 'text', body: 'hi' },
  unread_count: 1,
  waiting_for_reply: true,
  status: 'open',
  assignee: null,
  state_version: 0,
  ...over,
});
const listPage = (ws: string, items: Conversation[]) => ({
  workspace_id: ws,
  lens: { status: 'open' as const, assignee: 'all' as const },
  items,
  has_prev: false,
  has_next: false,
  next_cursor: null,
});
const message = (
  ws: string,
  cid: string,
  mid: string,
  received = '2026-10-18T10:00:00.000Z',
): ThreadMessage => ({
  type: 'message',
  id: mid,
  workspace_id: ws,
  conversation_id: cid,
  kind: 'text',
  body: 'hello',
  sent_at: received,
  received_at: received,
  edited_at: null,
  attachment: null,
  location: null,
  shared_contact: null,
  poll: null,
});
const threadPage = (ws: string, cid: string, items: ThreadPage['items']): ThreadPage => ({
  workspace_id: ws,
  conversation_id: cid,
  items,
  has_prev: false,
  has_next: false,
  prev_cursor: null,
  next_cursor: null,
  read_through_at: null,
});
const bot = (ws: string, over: Partial<InboxBotStatus> = {}): InboxBotStatus => ({
  workspace_id: ws,
  state: 'connected',
  can_reply: true,
  receiving: true,
  ...over,
});
const changed = (ws: string, cid: string, change: string, item: unknown) => ({
  v: 1,
  workspace_id: ws,
  type: 'conversation.changed',
  conversation_id: cid,
  item,
  change,
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.resetAllMocks();
  sockets.length = 0;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  useWorkspaceStore.getState().clear();
  useAuthStore.getState().setAccount({ id: ME, email: 'me@example.com', display_name: 'Me' });
  useInboxStore.getState().leave();
  api.listConversations.mockImplementation(async (ws: string) =>
    listPage(ws, [conv(ws, C1, '2026-10-18T10:00:00.000Z')]),
  );
  api.getInboxBotStatus.mockImplementation(async (ws: string) => bot(ws));
  api.listThreadItems.mockImplementation(async (ws: string, cid: string) =>
    threadPage(ws, cid, [message(ws, cid, id(500))]),
  );
});

describe('inbox store: entering a workspace', () => {
  it('starts loading, subscribes once to the frame connection, loads the first page and the bot status', async () => {
    const p = useInboxStore.getState().enter(A);
    expect(useInboxStore.getState()).toMatchObject({
      workspaceId: A,
      listStatus: 'loading',
      conversations: [],
    });
    await p;
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.workspaceId).toBe(A);
    expect(useInboxStore.getState()).toMatchObject({ listStatus: 'ready', bot: bot(A) });
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C1]);
  });

  it('entering the same workspace again subscribes no second time', async () => {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().enter(A);
    expect(sockets).toHaveLength(1);
  });

  it('a switch resets the store and drops the old subscription before anything renders; the old rows are never visible', async () => {
    await useInboxStore.getState().enter(A);
    const seen: string[][] = [];
    const unsub = useInboxStore.subscribe((s) =>
      seen.push(s.conversations.map((c) => c.workspace_id)),
    );
    api.listConversations.mockImplementation(async (ws: string) =>
      listPage(ws, [conv(ws, C2, '2026-10-18T11:00:00.000Z')]),
    );
    const p = useInboxStore.getState().enter(B);
    // synchronously after the call: old subscription dropped, nothing of A remains
    expect(sockets[0]!.close).toHaveBeenCalled();
    expect(useInboxStore.getState()).toMatchObject({
      workspaceId: B,
      listStatus: 'loading',
      conversations: [],
      bot: null,
    });
    await p;
    unsub();
    expect(seen.flat()).not.toContain(A);
    expect(useInboxStore.getState().conversations.map((c) => c.workspace_id)).toEqual([B]);
  });

  it('the workspace store changing its current workspace resets this store too', async () => {
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'owner' });
    await useInboxStore.getState().enter(A);
    useWorkspaceStore.getState().setCurrent({ id: B, name: 'Bolt', role: 'owner' });
    expect(sockets[0]!.close).toHaveBeenCalled();
    expect(useInboxStore.getState()).toMatchObject({ workspaceId: null, conversations: [] });
  });

  it('a late answer of A after switching to B is dropped', async () => {
    let release!: (v: unknown) => void;
    api.listConversations.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = useInboxStore.getState().enter(A);
    const second = useInboxStore.getState().enter(B);
    await second;
    release(listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z')]));
    await first;
    expect(useInboxStore.getState().conversations.every((c) => c.workspace_id === B)).toBe(true);
    expect(useInboxStore.getState().workspaceId).toBe(B);
  });

  it('a page tagged with another workspace is dropped even for the current request', async () => {
    api.listConversations.mockResolvedValue(listPage(B, [conv(B, C2, '2026-10-18T10:00:00.000Z')]));
    await useInboxStore.getState().enter(A);
    expect(useInboxStore.getState().conversations).toEqual([]);
  });
});

describe('inbox store: live frames', () => {
  it('a frame tagged with another workspace is dropped, nothing is fetched', async () => {
    await useInboxStore.getState().enter(A);
    api.getConversation.mockClear();
    sockets[0]!.handlers.onFrame(changed(B, C2, 'created', { type: 'message', id: id(501) }));
    await flush();
    expect(api.getConversation).not.toHaveBeenCalled();
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C1]);
  });

  it('created message: refetches the row, which moves to the top', async () => {
    api.listConversations.mockResolvedValue(
      listPage(A, [
        conv(A, C1, '2026-10-18T10:00:00.000Z'),
        conv(A, C2, '2026-10-18T09:00:00.000Z'),
      ]),
    );
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(
      conv(A, C2, '2026-10-18T12:00:00.000Z', { unread_count: 2 }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C2, 'created', { type: 'message', id: id(501) }));
    await flush();
    expect(api.getConversation).toHaveBeenCalledWith(A, C2, { background: true });
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C2, C1]);
  });

  it('a brand-new conversation appears at the top', async () => {
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(conv(A, C2, '2026-10-18T12:00:00.000Z'));
    sockets[0]!.handlers.onFrame(changed(A, C2, 'created', { type: 'message', id: id(501) }));
    await flush();
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C2, C1]);
  });

  it('a burst of 10 frames for one conversation is coalesced into at most two refetches', async () => {
    await useInboxStore.getState().enter(A);
    let release!: (v: unknown) => void;
    api.getConversation.mockImplementation(() => new Promise((r) => (release = r)));
    for (let i = 0; i < 10; i++)
      sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(600 + i) }));
    expect(api.getConversation).toHaveBeenCalledTimes(1);
    release(conv(A, C1, '2026-10-18T12:00:00.000Z'));
    await flush();
    expect(api.getConversation.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('open thread, visible tab: created message is fetched, merged and marked read with its received_at', async () => {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    const m = message(A, C1, id(502), '2026-10-18T12:00:00.000Z');
    api.getConversation.mockResolvedValue(conv(A, C1, '2026-10-18T12:00:00.000Z'));
    api.getThreadMessage.mockResolvedValue(m);
    api.markConversationRead.mockResolvedValue({});
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: m.id }));
    await flush();
    expect(api.getThreadMessage).toHaveBeenCalledWith(A, C1, m.id, { background: true });
    expect(useInboxStore.getState().thread?.items.map((i) => i.id)).toContain(m.id);
    expect(api.markConversationRead).toHaveBeenCalledWith(A, C1, m.received_at, {
      background: true,
    });
  });

  it('open thread, hidden tab: nothing is marked read', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.getConversation.mockResolvedValue(conv(A, C1, '2026-10-18T12:00:00.000Z'));
    api.getThreadMessage.mockResolvedValue(message(A, C1, id(502)));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(502) }));
    await flush();
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('thread not open: no thread fetch; created reply fetches only the reply when open', async () => {
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(conv(A, C1, '2026-10-18T12:00:00.000Z'));
    api.getThreadMessage.mockResolvedValue(message(A, C1, id(502)));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(502) }));
    await flush();
    expect(api.getThreadMessage).not.toHaveBeenCalled();
    expect(api.markConversationRead).not.toHaveBeenCalled();

    await useInboxStore.getState().openThread(A, C1);
    api.getConversation.mockClear();
    api.getThreadReply.mockResolvedValue({
      type: 'reply',
      id: id(700),
      workspace_id: A,
      conversation_id: C1,
    });
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'reply', id: id(700) }));
    await flush();
    expect(api.getThreadReply).toHaveBeenCalledWith(A, C1, id(700), { background: true });
    expect(api.getConversation).not.toHaveBeenCalled();
  });

  it('edited message: thread item refetched, no mark read', async () => {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.getThreadMessage.mockResolvedValue({
      ...message(A, C1, id(500)),
      body: 'fixed',
      edited_at: '2026-10-18T10:05:00.000Z',
    });
    sockets[0]!.handlers.onFrame(changed(A, C1, 'edited', { type: 'message', id: id(500) }));
    await flush();
    const item = useInboxStore.getState().thread?.items.find((i) => i.id === id(500));
    expect(item).toMatchObject({ body: 'fixed' });
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('read change: refetches the row only', async () => {
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(
      conv(A, C1, '2026-10-18T10:00:00.000Z', { unread_count: 0 }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C1, 'read', null));
    await flush();
    expect(useInboxStore.getState().conversations[0]!.unread_count).toBe(0);
  });

  it('bot.changed re-reads the bot status', async () => {
    await useInboxStore.getState().enter(A);
    api.getInboxBotStatus.mockResolvedValue(
      bot(A, { state: 'needs_token', can_reply: false, receiving: false }),
    );
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'bot.changed' });
    await flush();
    expect(useInboxStore.getState().bot).toMatchObject({ state: 'needs_token', can_reply: false });
  });

  it('a refetch answer tagged with another workspace is dropped', async () => {
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(
      conv(B, C1, '2026-10-18T13:00:00.000Z', { unread_count: 9 }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(503) }));
    await flush();
    expect(useInboxStore.getState().conversations[0]!.unread_count).toBe(1);
  });
});

describe('inbox store: recovery', () => {
  async function withOpenThread() {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.listConversations.mockClear();
    api.listThreadItems.mockClear();
    api.getInboxBotStatus.mockClear();
  }

  it('resync frame re-reads the first list page, the open thread latest page and the bot status', async () => {
    await withOpenThread();
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    expect(api.listConversations).toHaveBeenCalledTimes(1);
    expect(api.listThreadItems).toHaveBeenCalledTimes(1);
    expect(api.getInboxBotStatus).toHaveBeenCalledTimes(1);
    expect(api.listThreadItems.mock.calls[0]![1]).toBe(C1);
  });

  it('a reconnect triggers the same three re-reads, in the background (no loading state)', async () => {
    await withOpenThread();
    sockets[0]!.handlers.onReconnected();
    expect(useInboxStore.getState().listStatus).toBe('ready');
    await flush();
    expect(api.listConversations).toHaveBeenCalledTimes(1);
    expect(api.listThreadItems).toHaveBeenCalledTimes(1);
    expect(api.getInboxBotStatus).toHaveBeenCalledTimes(1);
  });

  it('socket closed 4403 or 4401: no new socket, the screen stays as shown', async () => {
    await useInboxStore.getState().enter(A);
    sockets[0]!.handlers.onClosed(4403);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(useInboxStore.getState()).toMatchObject({ live: 'stopped', workspaceId: A });
    expect(useInboxStore.getState().conversations).toHaveLength(1);
  });

  it('leave() closes the socket and clears everything', async () => {
    await useInboxStore.getState().enter(A);
    useInboxStore.getState().leave();
    expect(sockets[0]!.close).toHaveBeenCalled();
    expect(useInboxStore.getState()).toMatchObject({
      workspaceId: null,
      conversations: [],
      thread: null,
    });
  });
});

const replyItem = (ws: string, cid: string, rid: string, at: string) => ({
  type: 'reply' as const,
  id: rid,
  workspace_id: ws,
  conversation_id: cid,
  client_key: id(990),
  body: 'team',
  author: { account_id: id(950), display_name: 'Olena Operator' },
  state: 'sent' as const,
  failure_reason: null,
  position_at: at,
  sent_at: at,
  created_at: at,
});

describe('inbox store: guard answers (W1)', () => {
  it('a 401 on loading older history reaches the guard', async () => {
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(500))]),
      has_prev: true,
      prev_cursor: 'cur',
    });
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    const gone = new ApiError(401, 'UNAUTHENTICATED' as never, 'gone');
    api.listThreadItems.mockRejectedValueOnce(gone);
    await useInboxStore.getState().loadOlder(A, C1);
    expect(useInboxStore.getState().guardError).toBe(gone);
  });

  it('reportGuard hands a 403 of the current workspace to the guard, ignores other answers', async () => {
    await useInboxStore.getState().enter(A);
    useInboxStore.getState().reportGuard(new ApiError(500, 'INTERNAL_ERROR' as never, 'x'), A);
    expect(useInboxStore.getState().guardError).toBeNull();
    const removed = new ApiError(403, 'ACCESS_REMOVED' as never, 'removed');
    useInboxStore.getState().reportGuard(removed, B);
    expect(useInboxStore.getState().guardError).toBeNull();
    useInboxStore.getState().reportGuard(removed, A);
    expect(useInboxStore.getState().guardError).toBe(removed);
  });
});

describe('inbox store: drafts (W5, W9)', () => {
  it('an edited draft after a failed send gets a fresh client_key; an identical retry keeps it', async () => {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.sendReply.mockRejectedValue(new TypeError('network'));
    useInboxStore.getState().setDraftText(C1, 'Hello');
    await useInboxStore.getState().sendReply(A, C1);
    await useInboxStore.getState().sendReply(A, C1);
    const [first, retry] = api.sendReply.mock.calls.map((c) => c[2]);
    expect(retry.client_key).toBe(first.client_key);
    useInboxStore.getState().setDraftText(C1, 'Hello, we open at 9');
    await useInboxStore.getState().sendReply(A, C1);
    const edited = api.sendReply.mock.calls[2]![2];
    expect(edited.body).toBe('Hello, we open at 9');
    expect(edited.client_key).not.toBe(first.client_key);
  });

  it('last_seen_reply_id is the page newest_reply_id even when that reply is on an earlier page', async () => {
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(500))]),
      has_prev: true,
      prev_cursor: 'cur',
      newest_reply_id: id(777),
    });
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.sendReply.mockRejectedValue(new TypeError('network'));
    useInboxStore.getState().setDraftText(C1, 'Hi');
    await useInboxStore.getState().sendReply(A, C1);
    expect(api.sendReply.mock.calls[0]![2].last_seen_reply_id).toBe(id(777));
  });

  it('a live reply arriving later becomes the newest reply seen', async () => {
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(500))]),
      newest_reply_id: id(777),
    });
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.getThreadReply.mockResolvedValue(replyItem(A, C1, id(778), '2026-10-18T11:00:00.000Z'));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'reply', id: id(778) }));
    await flush();
    api.sendReply.mockRejectedValue(new TypeError('network'));
    useInboxStore.getState().setDraftText(C1, 'Hi');
    await useInboxStore.getState().sendReply(A, C1);
    expect(api.sendReply.mock.calls[0]![2].last_seen_reply_id).toBe(id(778));
  });
});

describe('inbox store: background re-reads merge (W7)', () => {
  it('a reconnect keeps earlier loaded pages and newer live items of the open thread', async () => {
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(510), '2026-10-18T10:10:00.000Z')]),
      has_prev: true,
      prev_cursor: 'cur-1',
    });
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.listThreadItems.mockResolvedValueOnce(
      threadPage(A, C1, [message(A, C1, id(505), '2026-10-18T10:05:00.000Z')]),
    );
    await useInboxStore.getState().loadOlder(A, C1);
    api.getThreadMessage.mockResolvedValue(message(A, C1, id(520), '2026-10-18T10:20:00.000Z'));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(520) }));
    await flush();
    // The re-read answers with a page that started before the live item arrived.
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [
        { ...message(A, C1, id(510), '2026-10-18T10:10:00.000Z'), body: 'edited' },
      ]),
      has_prev: true,
      prev_cursor: 'cur-1',
    });
    sockets[0]!.handlers.onReconnected();
    await flush();
    const open = useInboxStore.getState().thread!;
    expect(open.items.map((i) => i.id)).toEqual([id(505), id(510), id(520)]);
    expect(open.items[1]).toMatchObject({ body: 'edited' });
    expect(open.hasPrev).toBe(false);
  });

  it('a re-read latest page that does not overlap the shown items replaces them (R1, no hole)', async () => {
    const at = (n: number) => `2026-10-18T10:${String(n).padStart(2, '0')}:00.000Z`;
    api.listThreadItems.mockResolvedValueOnce(
      threadPage(A, C1, [message(A, C1, id(501), at(1)), message(A, C1, id(502), at(2))]),
    );
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    // A live item placed after the shown page; the gap between 502 and it was missed offline.
    api.getThreadMessage.mockResolvedValue(message(A, C1, id(540), at(40)));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(540) }));
    await flush();
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(536), at(36)), message(A, C1, id(540), at(40))]),
      has_prev: true,
      prev_cursor: 'cur-36',
    });
    sockets[0]!.handlers.onReconnected();
    await flush();
    const open = useInboxStore.getState().thread!;
    expect(open.items.map((i) => i.id)).toEqual([id(536), id(540)]);
    expect(open.hasPrev).toBe(true);
    expect(open.prevCursor).toBe('cur-36');
  });

  it('a replacing re-read keeps live items inside its range that the server read missed (R4)', async () => {
    const at = (n: number) => `2026-10-18T10:${String(n).padStart(2, '0')}:00.000Z`;
    api.listThreadItems.mockResolvedValueOnce(
      threadPage(A, C1, [message(A, C1, id(501), at(1)), message(A, C1, id(502), at(2))]),
    );
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.getThreadMessage.mockResolvedValue(message(A, C1, id(540), at(40)));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'created', { type: 'message', id: id(540) }));
    await flush();
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(536), at(36)), message(A, C1, id(550), at(50))]),
      has_prev: true,
      prev_cursor: 'cur-36',
    });
    sockets[0]!.handlers.onReconnected();
    await flush();
    expect(useInboxStore.getState().thread!.items.map((i) => i.id)).toEqual([
      id(536),
      id(540),
      id(550),
    ]);
  });

  it('an older page answering after a replacing re-read is dropped (R5)', async () => {
    const at = (n: number) => `2026-10-18T10:${String(n).padStart(2, '0')}:00.000Z`;
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(510), at(10))]),
      has_prev: true,
      prev_cursor: 'cur-old',
    });
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    let answerOlder!: (p: ThreadPage) => void;
    api.listThreadItems.mockReturnValueOnce(new Promise((r) => (answerOlder = r)));
    const older = useInboxStore.getState().loadOlder(A, C1);
    api.listThreadItems.mockResolvedValueOnce({
      ...threadPage(A, C1, [message(A, C1, id(536), at(36))]),
      has_prev: true,
      prev_cursor: 'cur-36',
    });
    sockets[0]!.handlers.onReconnected();
    await flush();
    answerOlder({
      ...threadPage(A, C1, [message(A, C1, id(505), at(5))]),
      has_prev: false,
      prev_cursor: null,
    });
    await older;
    const open = useInboxStore.getState().thread!;
    expect(open.items.map((i) => i.id)).toEqual([id(536)]);
    expect(open.hasPrev).toBe(true);
    expect(open.prevCursor).toBe('cur-36');
    expect(open.older).toBe('idle');
  });

  it('a re-read first list page drops shown rows that now sort below its last row (R1)', async () => {
    const C3 = id(103);
    api.listConversations.mockResolvedValueOnce({
      ...listPage(A, [
        conv(A, C1, '2026-10-18T12:00:00.000Z'),
        conv(A, C2, '2026-10-18T11:00:00.000Z'),
        conv(A, C3, '2026-10-18T10:00:00.000Z'),
      ]),
      has_next: true,
      next_cursor: 'n-1',
    });
    await useInboxStore.getState().enter(A);
    // Offline, other conversations got busier and C3 slid off the first page.
    api.listConversations.mockResolvedValueOnce({
      ...listPage(A, [
        conv(A, C2, '2026-10-18T13:00:00.000Z'),
        conv(A, C1, '2026-10-18T12:00:00.000Z'),
      ]),
      has_next: true,
      next_cursor: 'n-2',
    });
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    const state = useInboxStore.getState();
    expect(state.conversations.map((c) => c.id)).toEqual([C2, C1]);
    expect(state.nextCursor).toBe('n-2');
  });

  it('a resync keeps list rows that are not on the re-read first page and updates the rest', async () => {
    api.listConversations.mockResolvedValueOnce(
      listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z')]),
    );
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(conv(A, C2, '2026-10-18T12:00:00.000Z'));
    sockets[0]!.handlers.onFrame(changed(A, C2, 'created', { type: 'message', id: id(501) }));
    await flush();
    api.listConversations.mockResolvedValueOnce(
      listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z', { unread_count: 0 })]),
    );
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    const rows = useInboxStore.getState().conversations;
    expect(rows.map((c) => c.id)).toEqual([C2, C1]);
    expect(rows[1]!.unread_count).toBe(0);
  });
});

// ───────── assignment-statuses (T16) ─────────

const member = (accountId: string, name: string) => ({ account_id: accountId, display_name: name });
const summary = (
  ws: string,
  cid: string,
  over: Partial<ConversationSummary> = {},
): ConversationSummary => ({
  ...conv(ws, cid, '2026-10-18T10:00:00.000Z'),
  close_snapshot: { customer_message_seq: 4, latest_reply: null },
  ...over,
});
const activity = (
  ws: string,
  cid: string,
  aid: string,
  over: Partial<ThreadActivity> = {},
): ThreadActivity => ({
  type: 'activity',
  id: aid,
  workspace_id: ws,
  conversation_id: cid,
  kind: 'assigned',
  cause: 'member',
  actor: member(ME, 'Me'),
  previous_assignee: null,
  new_assignee: member(PEER, 'Peer'),
  position_at: '2026-10-18T10:05:00.000Z',
  ...over,
});
const lensPage = (
  ws: string,
  lens: { status: 'open' | 'closed' | null; assignee: 'all' | 'mine' | 'unassigned' },
  items: Conversation[],
) => ({ ...listPage(ws, items), lens });
const apiError = (status: number, code: string, details?: unknown) =>
  new ApiError(status, code as never, code, details);
const AID = id(700);

describe('inbox store: lenses', () => {
  it('starts at open · all and asks for the first page with the lenses', async () => {
    await useInboxStore.getState().enter(A);
    expect(useInboxStore.getState().lens).toEqual({ status: 'open', assignee: 'all' });
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({
      status: 'open',
      assignee: 'all',
    });
  });

  it('enter takes the lenses read from the address', async () => {
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'closed', assignee: 'mine' }, []),
    );
    await useInboxStore.getState().enter(A, { status: 'closed', assignee: 'mine' });
    expect(useInboxStore.getState()).toMatchObject({
      lens: { status: 'closed', assignee: 'mine' },
      listStatus: 'ready',
    });
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({
      status: 'closed',
      assignee: 'mine',
    });
  });

  it('setLens reloads the first page in the new lenses and keeps an open thread', async () => {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'open', assignee: 'unassigned' }, [
        conv(ws, C2, '2026-10-18T11:00:00.000Z'),
      ]),
    );
    await useInboxStore.getState().setLens(A, { status: 'open', assignee: 'unassigned' });
    const s = useInboxStore.getState();
    expect(s.lens).toEqual({ status: 'open', assignee: 'unassigned' });
    expect(s.conversations.map((c) => c.id)).toEqual([C2]);
    expect(s.thread?.conversationId).toBe(C1);
  });

  it('setLens with the same lenses reads nothing', async () => {
    await useInboxStore.getState().enter(A);
    api.listConversations.mockClear();
    await useInboxStore.getState().setLens(A, { status: 'open', assignee: 'all' });
    expect(api.listConversations).not.toHaveBeenCalled();
  });

  it('an answer for a lens already left is dropped', async () => {
    let release!: (v: unknown) => void;
    api.listConversations.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = useInboxStore.getState().enter(A);
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'closed', assignee: 'all' }, [
        conv(ws, C2, '2026-10-18T09:00:00.000Z', { status: 'closed' }),
      ]),
    );
    await useInboxStore.getState().setLens(A, { status: 'closed', assignee: 'all' });
    release(
      lensPage(A, { status: 'open', assignee: 'all' }, [conv(A, C1, '2026-10-18T10:00:00.000Z')]),
    );
    await first;
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C2]);
  });

  it('a page whose lens echo is not the requested one is dropped', async () => {
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'closed', assignee: 'all' }, [
        conv(ws, C1, '2026-10-18T10:00:00.000Z'),
      ]),
    );
    await useInboxStore.getState().enter(A);
    expect(useInboxStore.getState().conversations).toEqual([]);
  });

  it('a workspace switch resets the lenses to open · all', async () => {
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'closed', assignee: 'mine' }, []),
    );
    await useInboxStore.getState().enter(A, { status: 'closed', assignee: 'mine' });
    api.listConversations.mockImplementation(async (ws: string) => listPage(ws, []));
    await useInboxStore.getState().enter(B);
    expect(useInboxStore.getState().lens).toEqual({ status: 'open', assignee: 'all' });
    expect(api.listConversations.mock.calls.at(-1)![1]).toMatchObject({
      status: 'open',
      assignee: 'all',
    });
    useInboxStore.getState().leave();
    expect(useInboxStore.getState().lens).toEqual({ status: 'open', assignee: 'all' });
  });
});

describe('inbox store: the open conversation state', () => {
  const open = async (over: Partial<ConversationSummary> = {}) => {
    api.getConversation.mockResolvedValue(summary(A, C1, over));
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    await flush();
  };

  it('keeps the state version and the close snapshot of the summary it rendered', async () => {
    await open({
      state_version: 3,
      close_snapshot: { customer_message_seq: 9, latest_reply: null },
    });
    const t = useInboxStore.getState().thread!;
    expect(t.summary).toMatchObject({
      state_version: 3,
      close_snapshot: { customer_message_seq: 9, latest_reply: null },
    });
  });

  it('a resync replaces version and snapshot of the open conversation and re-reads the list in the lenses', async () => {
    await open({ state_version: 3 });
    api.getConversation.mockResolvedValue(
      summary(A, C1, {
        state_version: 5,
        status: 'closed',
        close_snapshot: { customer_message_seq: 11, latest_reply: null },
      }),
    );
    api.listConversations.mockClear();
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    expect(useInboxStore.getState().thread!.summary).toMatchObject({
      state_version: 5,
      close_snapshot: { customer_message_seq: 11 },
    });
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({
      status: 'open',
      assignee: 'all',
    });
  });

  it('an older answer never replaces a newer version', async () => {
    await open({ state_version: 4 });
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 2 }));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'state', null));
    await flush();
    expect(useInboxStore.getState().thread!.summary!.state_version).toBe(4);
  });
});

describe('inbox store: change actions', () => {
  const open = async (over: Partial<ConversationSummary> = {}) => {
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 3, ...over }));
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    await flush();
  };
  const store = () => useInboxStore.getState();

  it('assign sends the version on screen, then shows the new assignee in thread and row', async () => {
    await open();
    const act = activity(A, C1, AID);
    api.assignConversation.mockResolvedValue({
      workspace_id: A,
      outcome: 'recorded',
      conversation: summary(A, C1, { state_version: 4, assignee: member(PEER, 'Peer') }),
      activity: act,
    });
    const result = await store().assign(A, C1, PEER);
    expect(result.kind).toBe('recorded');
    expect(api.assignConversation).toHaveBeenCalledWith(
      A,
      C1,
      { assignee_account_id: PEER, expected_state_version: 3 },
      expect.anything(),
    );
    expect(store().thread!.summary).toMatchObject({
      state_version: 4,
      assignee: { account_id: PEER },
    });
    expect(store().thread!.items.map((i) => i.id)).toContain(AID);
    expect(store().conversations[0]).toMatchObject({
      assignee: { account_id: PEER },
      state_version: 4,
    });
  });

  it('unassign and reopen send the version on screen', async () => {
    await open({ status: 'closed', assignee: null });
    api.reopenConversation.mockResolvedValue({
      workspace_id: A,
      outcome: 'unchanged',
      conversation: summary(A, C1, { state_version: 3 }),
      activity: null,
    });
    expect((await store().reopen(A, C1)).kind).toBe('unchanged');
    expect(api.reopenConversation.mock.calls[0]!.slice(0, 3)).toEqual([
      A,
      C1,
      { expected_state_version: 3 },
    ]);
    api.unassignConversation.mockResolvedValue({
      workspace_id: A,
      outcome: 'unchanged',
      conversation: summary(A, C1, { state_version: 3 }),
      activity: null,
    });
    await store().unassign(A, C1);
    expect(api.unassignConversation.mock.calls[0]!.slice(0, 3)).toEqual([
      A,
      C1,
      { expected_state_version: 3 },
    ]);
  });

  it('a stale refusal replaces version and snapshot and returns the latest change', async () => {
    await open();
    const latest = activity(A, C1, AID, {
      kind: 'closed',
      previous_assignee: null,
      new_assignee: null,
    });
    api.assignConversation.mockRejectedValue(
      apiError(409, 'CONVERSATION_STATE_CHANGED', {
        conversation: summary(A, C1, {
          state_version: 6,
          status: 'closed',
          close_snapshot: { customer_message_seq: 8, latest_reply: null },
        }),
        latest_change: latest,
      }),
    );
    const result = await store().assign(A, C1, PEER);
    expect(result).toMatchObject({ kind: 'stale', latestChange: { id: AID } });
    expect(store().thread!.summary).toMatchObject({
      state_version: 6,
      status: 'closed',
      close_snapshot: { customer_message_seq: 8 },
    });
    // closed row leaves the open lens, the thread stays
    expect(store().conversations).toEqual([]);
    expect(store().thread?.conversationId).toBe(C1);
  });

  it('close without confirmation: the refusal snapshot replaces ours, confirm retry sends it', async () => {
    await open();
    const refusedSummary = summary(A, C1, {
      state_version: 3,
      close_snapshot: { customer_message_seq: 7, latest_reply: null },
    });
    api.closeConversation.mockRejectedValueOnce(
      apiError(409, 'CLOSE_NEEDS_CONFIRMATION', {
        reasons: ['customer_waiting'],
        stale_change: null,
        newest_unread_message: null,
        conversation: refusedSummary,
      }),
    );
    const first = await store().close(A, C1);
    expect(first).toMatchObject({ kind: 'needs_confirmation', reasons: ['customer_waiting'] });
    expect(api.closeConversation.mock.calls[0]![2]).toEqual({
      expected_state_version: 3,
      expected_close_snapshot: { customer_message_seq: 4, latest_reply: null },
      confirm_close_reasons: false,
    });
    expect(store().thread!.summary!.close_snapshot.customer_message_seq).toBe(7);

    api.closeConversation.mockResolvedValueOnce({
      workspace_id: A,
      outcome: 'recorded',
      conversation: summary(A, C1, { state_version: 4, status: 'closed' }),
      activity: activity(A, C1, AID, {
        kind: 'closed',
        previous_assignee: null,
        new_assignee: null,
      }),
    });
    const second = await store().close(A, C1, { confirm: true });
    expect(second.kind).toBe('recorded');
    expect(api.closeConversation.mock.calls[1]![2]).toEqual({
      expected_state_version: 3,
      expected_close_snapshot: { customer_message_seq: 7, latest_reply: null },
      confirm_close_reasons: true,
    });
    expect(store().thread!.summary!.status).toBe('closed');
  });

  it('maps the other refusals to typed outcomes', async () => {
    await open();
    api.assignConversation.mockRejectedValueOnce(
      apiError(400, 'ASSIGNEE_NOT_ACTIVE', { field: 'assignee_account_id' }),
    );
    expect((await store().assign(A, C1, PEER)).kind).toBe('assignee_not_active');
    api.assignConversation.mockRejectedValueOnce(
      apiError(429, 'CHANGE_LIMIT_REACHED', {
        limit: 60,
        window_seconds: 60,
        retry_at: '2026-10-18T10:01:00.000Z',
      }),
    );
    expect(await store().assign(A, C1, PEER)).toEqual({
      kind: 'limited',
      retryAt: '2026-10-18T10:01:00.000Z',
    });
    api.assignConversation.mockRejectedValueOnce(apiError(404, 'NOT_FOUND'));
    expect((await store().assign(A, C1, PEER)).kind).toBe('not_found');
    expect(store().thread!.status).toBe('not_found');
    api.assignConversation.mockRejectedValueOnce(apiError(403, 'ACCESS_REMOVED'));
    expect((await store().assign(A, C1, PEER)).kind).toBe('access_removed');
    expect(store().guardError?.status).toBe(403);
    api.assignConversation.mockRejectedValueOnce(new Error('network'));
    expect((await store().assign(A, C1, PEER)).kind).toBe('failed');
  });

  it('one change per conversation in flight', async () => {
    await open();
    let release!: (v: unknown) => void;
    api.assignConversation.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = store().assign(A, C1, PEER);
    expect((await store().unassign(A, C1)).kind).toBe('busy');
    expect(api.unassignConversation).not.toHaveBeenCalled();
    release({
      workspace_id: A,
      outcome: 'unchanged',
      conversation: summary(A, C1, { state_version: 3 }),
      activity: null,
    });
    await first;
    api.unassignConversation.mockRejectedValueOnce(new Error('x'));
    expect((await store().unassign(A, C1)).kind).toBe('failed');
  });

  it('without a rendered summary nothing is sent', async () => {
    await useInboxStore.getState().enter(A);
    expect((await store().assign(A, C1, PEER)).kind).toBe('failed');
    expect(api.assignConversation).not.toHaveBeenCalled();
  });

  it('an answer for a workspace left meanwhile is dropped', async () => {
    await open();
    let release!: (v: unknown) => void;
    api.assignConversation.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const p = store().assign(A, C1, PEER);
    await store().enter(B);
    release({
      workspace_id: A,
      outcome: 'recorded',
      conversation: summary(A, C1, { state_version: 4 }),
      activity: null,
    });
    expect((await p).kind).toBe('failed');
    expect(store().thread).toBeNull();
  });
});

describe('inbox store: activity frames', () => {
  const actFrame = (cid = C1, aid = AID) =>
    changed(A, cid, 'created', { type: 'activity', id: aid });
  const openAt = async (rows: Conversation[] = [conv(A, C1, '2026-10-18T10:00:00.000Z')]) => {
    api.listConversations.mockImplementation(async (ws: string) => listPage(ws, rows));
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 1 }));
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    await flush();
    api.getConversation.mockClear();
  };

  it('refetches the summary and, when the thread is open, the activity item, in the background', async () => {
    await openAt();
    api.getConversation.mockResolvedValue(
      summary(A, C1, { state_version: 2, assignee: member(PEER, 'Peer') }),
    );
    api.getThreadActivity.mockResolvedValue(activity(A, C1, AID));
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    expect(api.getConversation).toHaveBeenCalledWith(A, C1, { background: true });
    expect(api.getThreadActivity).toHaveBeenCalledWith(A, C1, AID, { background: true });
    const s = useInboxStore.getState();
    expect(s.thread!.summary!.state_version).toBe(2);
    expect(s.thread!.items.map((i) => i.id)).toContain(AID);
    expect(s.conversations[0]!.assignee?.account_id).toBe(PEER);
  });

  it('an activity id already shown is not fetched again', async () => {
    await openAt();
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 2 }));
    api.getThreadActivity.mockResolvedValue(activity(A, C1, AID));
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    api.getThreadActivity.mockClear();
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    expect(api.getThreadActivity).not.toHaveBeenCalled();
  });

  it('thread not open: only the row is re-read', async () => {
    await openAt();
    useInboxStore.getState().closeThread();
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 2 }));
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    expect(api.getConversation).toHaveBeenCalledTimes(1);
    expect(api.getThreadActivity).not.toHaveBeenCalled();
  });

  it('a burst of frames is coalesced', async () => {
    await openAt();
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 2 }));
    api.getThreadActivity.mockResolvedValue(activity(A, C1, AID));
    for (let i = 0; i < 6; i++) sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    expect(api.getConversation.mock.calls.length).toBeLessThanOrEqual(2);
    expect(api.getThreadActivity).toHaveBeenCalledTimes(1);
  });

  it('a row that leaves the lens is dropped while its thread stays open', async () => {
    await openAt();
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 2, status: 'closed' }));
    api.getThreadActivity.mockResolvedValue(
      activity(A, C1, AID, { kind: 'closed', previous_assignee: null, new_assignee: null }),
    );
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    const s = useInboxStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.thread!.summary!.status).toBe('closed');
    expect(s.thread!.status).toBe('ready');
  });

  it('a row that joins the lens is inserted at its activity place', async () => {
    await openAt([conv(A, C1, '2026-10-18T10:00:00.000Z')]);
    api.getConversation.mockResolvedValue(
      summary(A, C2, { last_activity_at: '2026-10-18T11:00:00.000Z' }),
    );
    sockets[0]!.handlers.onFrame(actFrame(C2, id(701)));
    await flush();
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C2, C1]);
  });

  it('while searching only the assignee lens decides', async () => {
    await openAt();
    useInboxStore.getState().setSearching(true);
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 2, status: 'closed' }));
    api.getThreadActivity.mockResolvedValue(activity(A, C1, AID));
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C1]);
    useInboxStore.getState().setSearching(false);
    expect(useInboxStore.getState().conversations).toEqual([]);
  });

  it('mine: an assignment to a teammate drops the row, to me keeps it', async () => {
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'open', assignee: 'mine' }, [
        conv(ws, C1, '2026-10-18T10:00:00.000Z', { assignee: member(ME, 'Me') }),
      ]),
    );
    await useInboxStore.getState().enter(A, { status: 'open', assignee: 'mine' });
    api.getConversation.mockResolvedValue(
      summary(A, C1, { state_version: 2, assignee: member(PEER, 'Peer') }),
    );
    sockets[0]!.handlers.onFrame(actFrame());
    await flush();
    expect(useInboxStore.getState().conversations).toEqual([]);
  });

  it('an activity frame of another workspace is dropped', async () => {
    await openAt();
    sockets[0]!.handlers.onFrame(changed(B, C1, 'created', { type: 'activity', id: AID }));
    await flush();
    expect(api.getConversation).not.toHaveBeenCalled();
  });

  it('an unparseable frame is dropped and the first page and the open summary are re-read in the current lenses', async () => {
    api.listConversations.mockImplementation(async (ws: string) =>
      lensPage(ws, { status: 'closed', assignee: 'unassigned' }, []),
    );
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 1 }));
    await useInboxStore.getState().enter(A, { status: 'closed', assignee: 'unassigned' });
    await useInboxStore.getState().openThread(A, C1);
    await flush();
    api.listConversations.mockClear();
    api.getConversation.mockClear();
    sockets[0]!.handlers.onInvalidFrame();
    sockets[0]!.handlers.onInvalidFrame();
    await flush();
    expect(api.listConversations.mock.calls.length).toBeLessThanOrEqual(2);
    expect(api.listConversations.mock.calls[0]![1]).toMatchObject({
      status: 'closed',
      assignee: 'unassigned',
    });
    expect(api.getConversation).toHaveBeenCalledWith(A, C1, { background: true });
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(useInboxStore.getState().live).toBe('live');
  });
});

// ───────── assignment-statuses review fixes (W1–W8) ─────────

describe('inbox store: refusals carry what they were about (W1, W2)', () => {
  const open = async (over: Partial<ConversationSummary> = {}) => {
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 3, ...over }));
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    await flush();
  };
  const store = () => useInboxStore.getState();

  it('a stale refusal hands back its own summary, even when a newer one is on screen', async () => {
    await open();
    let reject!: (e: unknown) => void;
    api.assignConversation.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    const pending = store().assign(A, C1, PEER);
    // a live summary overtakes the request
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 8 }));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'state', null));
    await flush();
    reject(
      apiError(409, 'CONVERSATION_STATE_CHANGED', {
        conversation: summary(A, C1, { state_version: 6, assignee: member(PEER, 'Peer') }),
        latest_change: null,
      }),
    );
    const result = await pending;
    expect(result).toMatchObject({ kind: 'stale', conversation: { state_version: 6 } });
    expect(store().thread!.summary!.state_version).toBe(8);
  });

  it('a needs-confirmation refusal hands back its own summary', async () => {
    await open();
    api.closeConversation.mockRejectedValueOnce(
      apiError(409, 'CLOSE_NEEDS_CONFIRMATION', {
        reasons: ['customer_waiting'],
        stale_change: null,
        newest_unread_message: null,
        conversation: summary(A, C1, {
          state_version: 3,
          close_snapshot: { customer_message_seq: 7, latest_reply: null },
        }),
      }),
    );
    expect(await store().close(A, C1)).toMatchObject({
      kind: 'needs_confirmation',
      conversation: { state_version: 3, close_snapshot: { customer_message_seq: 7 } },
    });
  });

  it('assign, unassign and reopen send an expected version when one is given', async () => {
    await open({ state_version: 9 });
    const ok = {
      workspace_id: A,
      outcome: 'unchanged',
      conversation: summary(A, C1, { state_version: 9 }),
      activity: null,
    };
    api.assignConversation.mockResolvedValue(ok);
    api.unassignConversation.mockResolvedValue(ok);
    api.reopenConversation.mockResolvedValue(ok);
    await store().assign(A, C1, PEER, { expected: { state_version: 6 } });
    await store().unassign(A, C1, { expected: { state_version: 6 } });
    await store().reopen(A, C1, { expected: { state_version: 6 } });
    expect(api.assignConversation.mock.calls[0]![2]).toEqual({
      assignee_account_id: PEER,
      expected_state_version: 6,
    });
    expect(api.unassignConversation.mock.calls[0]![2]).toEqual({ expected_state_version: 6 });
    expect(api.reopenConversation.mock.calls[0]![2]).toEqual({ expected_state_version: 6 });
  });
});

describe('inbox store: loaded pages follow live changes (W3)', () => {
  it('a row from a later page leaves the lens on a live close', async () => {
    api.listConversations.mockResolvedValueOnce({
      ...listPage(A, [conv(A, C1, '2026-10-18T12:00:00.000Z')]),
      has_next: true,
      next_cursor: 'n-1',
    });
    await useInboxStore.getState().enter(A);
    api.listConversations.mockResolvedValueOnce(
      listPage(A, [conv(A, C2, '2026-10-18T09:00:00.000Z', { state_version: 1 })]),
    );
    expect(await useInboxStore.getState().loadMore(A, 'list')).toBe('loaded');
    expect(api.listConversations.mock.calls.at(-1)![1]).toMatchObject({ after: 'n-1' });
    expect(useInboxStore.getState()).toMatchObject({ hasNext: false, nextCursor: null });
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C1, C2]);
    api.getConversation.mockResolvedValue(
      summary(A, C2, {
        state_version: 2,
        status: 'closed',
        last_activity_at: '2026-10-18T09:00:00.000Z',
      }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C2, 'state', null));
    await flush();
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C1]);
  });

  it('a page answering after the first page was re-read is dropped', async () => {
    api.listConversations.mockResolvedValueOnce({
      ...listPage(A, [conv(A, C1, '2026-10-18T12:00:00.000Z')]),
      has_next: true,
      next_cursor: 'n-1',
    });
    await useInboxStore.getState().enter(A);
    let release!: (v: unknown) => void;
    api.listConversations.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const more = useInboxStore.getState().loadMore(A, 'list');
    api.listConversations.mockResolvedValueOnce({
      ...listPage(A, [conv(A, C1, '2026-10-18T12:00:00.000Z')]),
      has_next: true,
      next_cursor: 'n-2',
    });
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    release(listPage(A, [conv(A, C2, '2026-10-18T09:00:00.000Z')]));
    expect(await more).toBe('dropped');
    expect(useInboxStore.getState().conversations.map((c) => c.id)).toEqual([C1]);
    expect(useInboxStore.getState().nextCursor).toBe('n-2');
  });
});

describe('inbox store: search results follow live changes (W4)', () => {
  const SEARCH = { status: null, assignee: 'all' } as const;
  const enterAndSearch = async (rows: Conversation[], assignee: 'all' | 'mine' = 'all') => {
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? lensPage(ws, { ...SEARCH, assignee }, rows)
        : lensPage(ws, { status: 'open', assignee }, []),
    );
    await useInboxStore.getState().enter(A, { status: 'open', assignee });
    useInboxStore.getState().setSearching(true);
    await useInboxStore.getState().search(A, 'Ada');
  };
  const results = () => useInboxStore.getState().results?.page?.rows ?? [];

  it('searches in the assignee lens and keeps the answer', async () => {
    await enterAndSearch([conv(A, C1, '2026-10-18T10:00:00.000Z')]);
    expect(api.listConversations.mock.calls.at(-1)![1]).toMatchObject({
      q: 'Ada',
      assignee: 'all',
    });
    expect(useInboxStore.getState().results).toMatchObject({ q: 'Ada', status: 'ready' });
    expect(results().map((c) => c.id)).toEqual([C1]);
  });

  it('a live assignment and close update the shown result in place', async () => {
    await enterAndSearch([conv(A, C1, '2026-10-18T10:00:00.000Z')]);
    api.getConversation.mockResolvedValue(
      summary(A, C1, { state_version: 2, status: 'closed', assignee: member(PEER, 'Peer') }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C1, 'state', null));
    await flush();
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'closed', assignee: { account_id: PEER } });
  });

  it('mine: a result assigned to a teammate leaves the results', async () => {
    await enterAndSearch(
      [conv(A, C1, '2026-10-18T10:00:00.000Z', { assignee: member(ME, 'Me') })],
      'mine',
    );
    api.getConversation.mockResolvedValue(
      summary(A, C1, { state_version: 2, assignee: member(PEER, 'Peer') }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C1, 'state', null));
    await flush();
    expect(results()).toEqual([]);
  });

  it('a conversation that joins the assignee lens joins the results without a re-search', async () => {
    await enterAndSearch([], 'mine');
    api.listConversations.mockClear();
    api.getConversation.mockResolvedValue(
      summary(A, C2, { state_version: 2, assignee: member(ME, 'Me') }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C2, 'state', null));
    await flush();
    expect(api.listConversations.mock.calls.some((c) => c[1]?.q === 'Ada')).toBe(false);
    expect(results().map((c) => c.id)).toEqual([C2]);
  });

  it('a resync re-runs the search', async () => {
    await enterAndSearch([conv(A, C1, '2026-10-18T10:00:00.000Z')]);
    api.listConversations.mockClear();
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    expect(api.listConversations.mock.calls.some((c) => c[1]?.q === 'Ada')).toBe(true);
  });

  it('the results page further from their cursor', async () => {
    api.listConversations.mockImplementation(
      async (ws: string, params: { q?: string; after?: string }) =>
        params.after
          ? lensPage(ws, SEARCH, [conv(ws, C2, '2026-10-18T09:00:00.000Z')])
          : params.q
            ? {
                ...lensPage(ws, SEARCH, [conv(ws, C1, '2026-10-18T10:00:00.000Z')]),
                has_next: true,
                next_cursor: 'q1',
              }
            : listPage(ws, []),
    );
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().search(A, 'Ada');
    expect(await useInboxStore.getState().loadMore(A, 'results')).toBe('loaded');
    expect(api.listConversations.mock.calls.at(-1)![1]).toMatchObject({ q: 'Ada', after: 'q1' });
    expect(results().map((c) => c.id)).toEqual([C1, C2]);
  });
});

describe('inbox store: search results on live frames and resyncs (re-review R1, R2, RR1–RR3)', () => {
  const SEARCH = { status: null, assignee: 'all' } as const;
  const C3 = id(103);
  const C4 = id(104);
  const who = (first_name: string) => ({
    id: id(901),
    first_name,
    last_name: null,
    username: null,
  });
  const results = () => useInboxStore.getState().results;
  const rowIds = () => results()?.page?.rows.map((c) => c.id) ?? [];
  const searchCalls = (q?: string) =>
    api.listConversations.mock.calls.filter((c) => (q === undefined ? c[1]?.q : c[1]?.q === q));
  /** The next search read (any query) hangs until released; other reads keep answering. */
  const hangingSearch = () => {
    let release!: (v: unknown) => void;
    const fallback = api.listConversations.getMockImplementation()!;
    let taken = false;
    api.listConversations.mockImplementation((ws: string, params: { q?: string }) => {
      if (!params.q || taken) return fallback(ws, params);
      taken = true;
      return new Promise((r) => (release = r));
    });
    return (v: unknown) => release(v);
  };
  const hanging = () => {
    let release!: (v: unknown) => void;
    api.listConversations.mockImplementationOnce(() => new Promise((r) => (release = r)));
    return (v: unknown) => release(v);
  };
  const frame = async (cid: string) => {
    sockets[0]!.handlers.onFrame(changed(A, cid, 'state', null));
    await flush();
  };
  const resync = async () => {
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
  };
  const enterAndSearch = async (
    q: string,
    page: Conversation[],
    more: { cursor: string } | null = null,
    assignee: 'all' | 'mine' = 'all',
  ) => {
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? {
            ...lensPage(ws, { ...SEARCH, assignee }, page),
            has_next: more !== null,
            next_cursor: more?.cursor ?? null,
          }
        : lensPage(ws, { status: 'open', assignee }, []),
    );
    await useInboxStore.getState().enter(A, { status: 'open', assignee });
    useInboxStore.getState().setSearching(true);
    await useInboxStore.getState().search(A, q);
  };

  it('R1: a resync re-search of the old query does not cancel the newer search typed', async () => {
    await enterAndSearch('al', [conv(A, C1, '2026-10-18T10:00:00.000Z', { contact: who('Alan') })]);
    const bob = [conv(A, C3, '2026-10-18T11:00:00.000Z', { contact: who('Bob') })];
    const releaseBackground = hangingSearch();
    await resync();
    const releaseBob = hanging();
    const typed = useInboxStore.getState().search(A, 'bob');
    releaseBackground(lensPage(A, SEARCH, [conv(A, C1, '2026-10-18T10:00:00.000Z')]));
    await flush();
    releaseBob(lensPage(A, SEARCH, bob));
    await typed;
    await flush();
    expect(results()).toMatchObject({ q: 'bob', status: 'ready' });
    expect(rowIds()).toEqual([C3]);
  });

  it('R2: live frames never search again; a joiner is placed among the loaded pages', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')], { cursor: 'q1' });
    api.listConversations.mockResolvedValueOnce(
      lensPage(A, SEARCH, [conv(A, C2, '2026-10-18T09:00:00.000Z')]),
    );
    expect(await useInboxStore.getState().loadMore(A, 'results')).toBe('loaded');
    api.listConversations.mockClear();
    api.getConversation.mockResolvedValue(
      summary(A, C3, { state_version: 1, last_activity_at: '2026-10-18T13:00:00.000Z' }),
    );
    await frame(C3);
    expect(searchCalls()).toEqual([]);
    expect(rowIds()).toEqual([C3, C1, C2]);
    expect(results()?.page).toMatchObject({ hasNext: false, cursor: null });
  });

  it('R2: a live joiner does not drop the next page in flight', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')], { cursor: 'q1' });
    const releaseMore = hanging();
    const more = useInboxStore.getState().loadMore(A, 'results');
    api.getConversation.mockResolvedValue(
      summary(A, C3, { state_version: 1, last_activity_at: '2026-10-18T13:00:00.000Z' }),
    );
    await frame(C3);
    releaseMore(lensPage(A, SEARCH, [conv(A, C2, '2026-10-18T09:00:00.000Z')]));
    expect(await more).toBe('loaded');
    expect(rowIds()).toEqual([C3, C1, C2]);
  });

  it('R2: a row that just left the lens stays out of a resync re-search read before', async () => {
    await enterAndSearch(
      'Ada',
      [conv(A, C1, '2026-10-18T12:00:00.000Z', { assignee: member(ME, 'Me'), state_version: 1 })],
      null,
      'mine',
    );
    const releaseBackground = hangingSearch();
    await resync();
    api.getConversation.mockResolvedValueOnce(
      summary(A, C1, {
        state_version: 2,
        assignee: member(PEER, 'Peer'),
        last_activity_at: '2026-10-18T12:00:00.000Z',
      }),
    );
    await frame(C1);
    expect(rowIds()).toEqual([]);
    releaseBackground(
      lensPage(A, { ...SEARCH, assignee: 'mine' }, [
        conv(A, C1, '2026-10-18T12:00:00.000Z', { assignee: member(ME, 'Me'), state_version: 1 }),
        conv(A, C3, '2026-10-18T10:00:00.000Z', { assignee: member(ME, 'Me'), state_version: 1 }),
      ]),
    );
    await flush();
    expect(rowIds()).toEqual([C3]);
  });

  it('R2: a next page read before a row left the lens does not bring it back', async () => {
    await enterAndSearch(
      'Ada',
      [conv(A, C1, '2026-10-18T12:00:00.000Z', { assignee: member(ME, 'Me') })],
      { cursor: 'q1' },
      'mine',
    );
    const releaseMore = hanging();
    const more = useInboxStore.getState().loadMore(A, 'results');
    api.getConversation.mockResolvedValueOnce(
      summary(A, C2, {
        state_version: 2,
        assignee: member(PEER, 'Peer'),
        last_activity_at: '2026-10-18T09:00:00.000Z',
      }),
    );
    await frame(C2);
    releaseMore(
      lensPage(A, { ...SEARCH, assignee: 'mine' }, [
        conv(A, C2, '2026-10-18T09:00:00.000Z', { assignee: member(ME, 'Me'), state_version: 1 }),
      ]),
    );
    expect(await more).toBe('loaded');
    expect(rowIds()).toEqual([C1]);
  });

  it('R2: a row whose contact the search cannot find does not join', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')]);
    api.listConversations.mockClear();
    api.getConversation.mockResolvedValue(
      summary(A, C2, { state_version: 1, contact: who('Bob') }),
    );
    await frame(C2);
    expect(searchCalls()).toEqual([]);
    expect(rowIds()).toEqual([C1]);
  });

  it('R2: a row below the loaded results while more pages wait does not join (paging reaches it)', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')], { cursor: 'q1' });
    api.listConversations.mockClear();
    api.getConversation.mockResolvedValue(
      summary(A, C4, { state_version: 1, last_activity_at: '2026-10-18T08:00:00.000Z' }),
    );
    await frame(C4);
    expect(searchCalls()).toEqual([]);
    expect(rowIds()).toEqual([C1]);
  });

  it('R2: a matching row within the loaded results joins directly, by the server match rule', async () => {
    await enterAndSearch('@ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')], { cursor: 'q1' });
    api.listConversations.mockClear();
    api.getConversation.mockResolvedValue(
      summary(A, C4, { state_version: 1, last_activity_at: '2026-10-18T13:00:00.000Z' }),
    );
    await frame(C4);
    expect(searchCalls()).toEqual([]);
    expect(rowIds()).toEqual([C4, C1]);
  });

  it('RR1: after a failed typed search, neither a resync nor a live frame touches the old rows', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')]);
    api.listConversations.mockRejectedValueOnce(new Error('offline'));
    await useInboxStore.getState().search(A, 'Bob');
    expect(results()).toMatchObject({ q: 'Bob', status: 'error' });
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? lensPage(ws, SEARCH, [conv(ws, C3, '2026-10-18T11:00:00.000Z', { contact: who('Bob') })])
        : listPage(ws, []),
    );
    await resync();
    api.getConversation.mockResolvedValue(
      summary(A, C4, { state_version: 1, contact: who('Bob') }),
    );
    await frame(C4);
    expect(results()).toMatchObject({ q: 'Bob', status: 'error' });
    expect(rowIds()).toEqual([C1]);
  });

  it('RR2: a joiner below the first page but within the loaded pages joins', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')], { cursor: 'q1' });
    api.listConversations.mockResolvedValueOnce(
      lensPage(A, SEARCH, [conv(A, C2, '2026-10-18T09:00:00.000Z')]),
    );
    expect(await useInboxStore.getState().loadMore(A, 'results')).toBe('loaded');
    api.getConversation.mockResolvedValue(
      summary(A, C3, { state_version: 1, last_activity_at: '2026-10-18T10:00:00.000Z' }),
    );
    await frame(C3);
    expect(rowIds()).toEqual([C1, C3, C2]);
  });

  it('RR2: a resync replaces the results with the first page and its cursor', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')], { cursor: 'q1' });
    api.listConversations.mockResolvedValueOnce(
      lensPage(A, SEARCH, [conv(A, C2, '2026-10-18T09:00:00.000Z')]),
    );
    expect(await useInboxStore.getState().loadMore(A, 'results')).toBe('loaded');
    expect(rowIds()).toEqual([C1, C2]);
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? {
            ...lensPage(ws, SEARCH, [conv(ws, C3, '2026-10-18T13:00:00.000Z')]),
            has_next: true,
            next_cursor: 'q2',
          }
        : listPage(ws, []),
    );
    await resync();
    expect(rowIds()).toEqual([C3]);
    expect(results()).toMatchObject({ status: 'ready', page: { hasNext: true, cursor: 'q2' } });
  });

  it('a resync keeps a shown row newer than the re-read page (it arrived live after the read)', async () => {
    await enterAndSearch('Ada', [
      conv(A, C2, '2026-10-18T14:00:00.000Z'),
      conv(A, C1, '2026-10-18T12:00:00.000Z'),
    ]);
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? lensPage(ws, SEARCH, [conv(ws, C3, '2026-10-18T13:00:00.000Z')])
        : listPage(ws, []),
    );
    await resync();
    expect(rowIds()).toEqual([C2, C3]);
  });

  it('RR3: a resync while a typed search loads re-searches once after it answers', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')]);
    const releaseBob = hanging();
    const typed = useInboxStore.getState().search(A, 'Bob');
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? lensPage(ws, SEARCH, [conv(ws, C4, '2026-10-18T13:00:00.000Z', { contact: who('Bob') })])
        : listPage(ws, []),
    );
    await resync();
    await resync();
    expect(searchCalls('Bob')).toHaveLength(1);
    releaseBob(
      lensPage(A, SEARCH, [conv(A, C3, '2026-10-18T11:00:00.000Z', { contact: who('Bob') })]),
    );
    await typed;
    await flush();
    expect(searchCalls('Bob')).toHaveLength(2);
    expect(results()).toMatchObject({ q: 'Bob', status: 'ready' });
    expect(rowIds()).toEqual([C4]);
  });

  it('RR3: a resync while a typed search loads leaves the failed results as they are', async () => {
    await enterAndSearch('Ada', [conv(A, C1, '2026-10-18T12:00:00.000Z')]);
    let fail!: (e: unknown) => void;
    api.listConversations.mockImplementationOnce(() => new Promise((_, r) => (fail = r)));
    const typed = useInboxStore.getState().search(A, 'Bob');
    api.listConversations.mockImplementation(async (ws: string, params: { q?: string }) =>
      params.q
        ? lensPage(ws, SEARCH, [conv(ws, C4, '2026-10-18T13:00:00.000Z', { contact: who('Bob') })])
        : listPage(ws, []),
    );
    await resync();
    fail(new Error('offline'));
    await typed;
    await flush();
    // The pending re-search ran once the typed search settled; failed results are not `ready`.
    expect(searchCalls('Bob')).toHaveLength(1);
    expect(results()).toMatchObject({ q: 'Bob', status: 'error' });
    expect(rowIds()).toEqual([C1]);
    // Retrying the typed search heals it; the pending re-search does not fire again.
    await useInboxStore.getState().search(A, 'Bob');
    await flush();
    expect(searchCalls('Bob')).toHaveLength(2);
    expect(rowIds()).toEqual([C4]);
  });
});

describe('inbox store: re-reads at the same state version (W6)', () => {
  it('an older copy at the same version replaces neither the row nor the open summary', async () => {
    api.listConversations.mockResolvedValue(
      listPage(A, [conv(A, C1, '2026-10-18T10:05:00.000Z', { state_version: 3, unread_count: 2 })]),
    );
    api.getConversation.mockResolvedValue(
      summary(A, C1, {
        state_version: 3,
        last_activity_at: '2026-10-18T10:05:00.000Z',
        unread_count: 2,
        close_snapshot: { customer_message_seq: 9, latest_reply: null },
      }),
    );
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    await flush();
    api.getConversation.mockResolvedValue(
      summary(A, C1, {
        state_version: 3,
        last_activity_at: '2026-10-18T10:00:00.000Z',
        unread_count: 1,
        close_snapshot: { customer_message_seq: 8, latest_reply: null },
      }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C1, 'read', null));
    await flush();
    const s = useInboxStore.getState();
    expect(s.conversations[0]).toMatchObject({
      unread_count: 2,
      last_activity_at: '2026-10-18T10:05:00.000Z',
    });
    expect(s.thread!.summary!.close_snapshot.customer_message_seq).toBe(9);
  });

  it('a re-read first page keeps a shown row with a higher state version', async () => {
    api.listConversations.mockResolvedValueOnce(
      listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z', { state_version: 3 })]),
    );
    await useInboxStore.getState().enter(A);
    api.getConversation.mockResolvedValue(
      summary(A, C1, { state_version: 5, assignee: member(PEER, 'Peer') }),
    );
    sockets[0]!.handlers.onFrame(changed(A, C1, 'state', null));
    await flush();
    api.listConversations.mockResolvedValueOnce(
      listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z', { state_version: 4 })]),
    );
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    await flush();
    expect(useInboxStore.getState().conversations[0]).toMatchObject({
      state_version: 5,
      assignee: { account_id: PEER },
    });
  });

  it('a row that left the lens through a newer version is not brought back by an older page', async () => {
    api.listConversations.mockResolvedValueOnce(
      listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z', { state_version: 3 })]),
    );
    await useInboxStore.getState().enter(A);
    let release!: (v: unknown) => void;
    api.listConversations.mockImplementationOnce(() => new Promise((r) => (release = r)));
    sockets[0]!.handlers.onFrame({ v: 1, workspace_id: A, type: 'resync' });
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 4, status: 'closed' }));
    sockets[0]!.handlers.onFrame(changed(A, C1, 'state', null));
    await flush();
    expect(useInboxStore.getState().conversations).toEqual([]);
    release(listPage(A, [conv(A, C1, '2026-10-18T10:00:00.000Z', { state_version: 3 })]));
    await flush();
    expect(useInboxStore.getState().conversations).toEqual([]);
  });
});

describe('inbox store: list retry (W7) and coalesced resync (W8)', () => {
  it('retryList re-reads the first page and keeps the open thread', async () => {
    api.listConversations.mockRejectedValueOnce(new Error('net'));
    api.getConversation.mockResolvedValue(summary(A, C1, { state_version: 1 }));
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().openThread(A, C1);
    await flush();
    expect(useInboxStore.getState().listStatus).toBe('error');
    await useInboxStore.getState().retryList(A);
    const s = useInboxStore.getState();
    expect(s.listStatus).toBe('ready');
    expect(s.conversations.map((c) => c.id)).toEqual([C1]);
    expect(s.thread).toMatchObject({ conversationId: C1, status: 'ready' });
    expect(sockets).toHaveLength(1);
  });

  it('invalid frames while a resync is still re-reading collapse into one more resync', async () => {
    await useInboxStore.getState().enter(A);
    const releases: ((v: unknown) => void)[] = [];
    api.listConversations.mockImplementation(
      (ws: string) =>
        new Promise((r) =>
          releases.push(() => r(listPage(ws, [conv(ws, C1, '2026-10-18T10:00:00.000Z')]))),
        ),
    );
    api.listConversations.mockClear();
    for (let i = 0; i < 4; i++) sockets[0]!.handlers.onInvalidFrame();
    await flush();
    expect(api.listConversations).toHaveBeenCalledTimes(1);
    releases[0]!(undefined);
    await flush();
    expect(api.listConversations).toHaveBeenCalledTimes(2);
    releases[1]!(undefined);
    await flush();
    expect(api.listConversations).toHaveBeenCalledTimes(2);
  });
});
