import type { Conversation, InboxBotStatus, ThreadMessage, ThreadPage } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';
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
  onReconnected: () => void;
  onClosed: (code: number) => void;
}
const sockets: { workspaceId: string; handlers: Handlers; close: ReturnType<typeof vi.fn> }[] = [];
vi.mock('@/shared/api/realtime', () => ({
  openLiveSocket: (workspaceId: string, handlers: Handlers) => {
    const s = { workspaceId, handlers, close: vi.fn() };
    sockets.push(s);
    return s;
  },
}));

import { useInboxStore } from './store';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const A = id(1);
const B = id(2);
const C1 = id(101);
const C2 = id(102);

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
  ...over,
});
const listPage = (ws: string, items: Conversation[]) => ({
  workspace_id: ws,
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
  it('starts loading, opens one socket, loads the first page and the bot status', async () => {
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

  it('entering the same workspace again opens no second socket', async () => {
    await useInboxStore.getState().enter(A);
    await useInboxStore.getState().enter(A);
    expect(sockets).toHaveLength(1);
  });

  it('a switch resets the store and closes the old socket before anything renders; the old rows are never visible', async () => {
    await useInboxStore.getState().enter(A);
    const seen: string[][] = [];
    const unsub = useInboxStore.subscribe((s) =>
      seen.push(s.conversations.map((c) => c.workspace_id)),
    );
    api.listConversations.mockImplementation(async (ws: string) =>
      listPage(ws, [conv(ws, C2, '2026-10-18T11:00:00.000Z')]),
    );
    const p = useInboxStore.getState().enter(B);
    // synchronously after the call: old socket closed, nothing of A remains
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
