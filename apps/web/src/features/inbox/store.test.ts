import type { Conversation, InboxBotStatus, ThreadMessage, ThreadPage } from '@tg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/features/workspaces/store';

const api = {
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listThreadItems: vi.fn(),
  getThreadMessage: vi.fn(),
  getThreadReply: vi.fn(),
  markConversationRead: vi.fn(),
  getInboxBotStatus: vi.fn(),
};
vi.mock('./api-source', () => ({
  listConversations: (...a: unknown[]) => api.listConversations(...a),
  getConversation: (...a: unknown[]) => api.getConversation(...a),
  listThreadItems: (...a: unknown[]) => api.listThreadItems(...a),
  getThreadMessage: (...a: unknown[]) => api.getThreadMessage(...a),
  getThreadReply: (...a: unknown[]) => api.getThreadReply(...a),
  markConversationRead: (...a: unknown[]) => api.markConversationRead(...a),
  getInboxBotStatus: (...a: unknown[]) => api.getInboxBotStatus(...a),
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
