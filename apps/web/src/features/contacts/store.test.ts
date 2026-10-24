import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type ContactPage,
  type ContactProfile,
  type ConversationSummary,
  type LiveFrame,
  type TagHistoryPage,
  type ThreadMessage,
  type ThreadPage,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';

const api = vi.hoisted(() => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  listContactTagHistory: vi.fn(),
  getContactConversation: vi.fn(),
  listThreadItems: vi.fn(),
  markConversationRead: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listContacts: (...a: unknown[]) => api.listContacts(...a),
  getContact: (...a: unknown[]) => api.getContact(...a),
  listContactTagHistory: (...a: unknown[]) => api.listContactTagHistory(...a),
  getContactConversation: (...a: unknown[]) => api.getContactConversation(...a),
}));
vi.mock('@/features/inbox/api-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/inbox/api-source')>()),
  listThreadItems: (...a: unknown[]) => api.listThreadItems(...a),
  markConversationRead: (...a: unknown[]) => api.markConversationRead(...a),
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

import { queryKey, useContactsStore } from './store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C1 = id(901);
const C2 = id(902);
const CONV = id(101);
const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 10, min)).toISOString();
const guard = vi.fn();
const settle = () => new Promise((r) => setTimeout(r, 0));

const row = (n: number, over: Partial<ContactPage['items'][number]> = {}) => ({
  id: id(900 + n),
  workspace_id: A,
  first_name: `Customer ${n}`,
  last_name: null,
  username: null,
  language_code: null,
  first_wrote_at: null,
  last_wrote_at: null,
  blocked_since: null as string | null,
  tags: [],
  ...over,
});
const page = (over: Partial<ContactPage> = {}): ContactPage => ({
  workspace_id: A,
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
const profile = (contactId = C1, over: Partial<ContactProfile> = {}): ContactProfile => ({
  id: contactId,
  workspace_id: A,
  first_name: 'Ada',
  last_name: null,
  username: 'ada',
  language_code: 'uk',
  first_wrote_at: at(0),
  last_wrote_at: at(5),
  blocked_since: null,
  tags: [],
  ...over,
});
const history = (over: Partial<TagHistoryPage> = {}): TagHistoryPage => ({
  workspace_id: A,
  contact_id: C1,
  items: [],
  has_prev: false,
  has_next: false,
  next_cursor: null,
  ...over,
});
const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: CONV,
  workspace_id: A,
  contact: { id: C1, first_name: 'Ada', last_name: null, username: 'ada' },
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
const message = (n: number, min: number): ThreadMessage =>
  ({
    type: 'message',
    id: id(500 + n),
    workspace_id: A,
    conversation_id: CONV,
    kind: 'text',
    body: `m${n}`,
    sent_at: at(min),
    received_at: at(min),
    edited_at: null,
    attachment: null,
    location: null,
    contact: null,
    poll: null,
  }) as unknown as ThreadMessage;
const thread = (items: ThreadMessage[], over: Partial<ThreadPage> = {}): ThreadPage => ({
  workspace_id: A,
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
const frame = (f: Record<string, unknown>) =>
  ({ v: 1, workspace_id: A, ...f }) as unknown as LiveFrame;
const emit = (f: LiveFrame) => {
  for (const s of live.subs) (s.subscriber.onFrame as (f: LiveFrame) => void)(f);
};
const query = { q: '', mode: 'any' as const, tagIds: [] };

function openEverything() {
  api.getContact.mockResolvedValue(profile());
  api.listContactTagHistory.mockResolvedValue(history());
  api.getContactConversation.mockResolvedValue(summary());
  api.listThreadItems.mockResolvedValue(thread([message(1, 1), message(2, 2)]));
}
const calls = () => ({
  contact: api.getContact.mock.calls.length,
  history: api.listContactTagHistory.mock.calls.length,
  conversation: api.getContactConversation.mock.calls.length,
  items: api.listThreadItems.mock.calls.length,
});

beforeEach(() => {
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  useContactsStore.getState().clear();
});

describe('contacts store: the list', () => {
  it('reads the first page and appends the next 50 after the cursor without repeats', async () => {
    api.listContacts.mockResolvedValueOnce(
      page({ items: [row(1), row(2)], has_next: true, next_cursor: 'c1', total_count: 120 }),
    );
    await useContactsStore.getState().loadList(A, query, guard);
    expect(useContactsStore.getState().list).toMatchObject({
      status: 'ready',
      hasNext: true,
      totalCount: 120,
    });
    api.listContacts.mockResolvedValueOnce(page({ items: [row(2), row(3)], total_count: 120 }));
    await useContactsStore.getState().loadMore(A, guard);
    expect(api.listContacts).toHaveBeenLastCalledWith(
      A,
      { q: '', mode: 'any', tag: [], after: 'c1' },
      {},
    );
    const list = useContactsStore.getState().list!;
    expect(list.items.map((c) => c.id)).toEqual([id(901), id(902), id(903)]);
    expect(list.hasNext).toBe(false);
  });

  it('sends the search, the mode and the tag ids and drops a late answer of an earlier query', async () => {
    let late!: (v: unknown) => void;
    api.listContacts.mockImplementationOnce(() => new Promise((r) => (late = r)));
    const first = useContactsStore.getState().loadList(A, query, guard);
    api.listContacts.mockResolvedValueOnce(page({ items: [row(7)], matching_count: 1 }));
    const next = { q: 'ada', mode: 'all' as const, tagIds: [id(300), id(301)] };
    await useContactsStore.getState().loadList(A, next, guard);
    late(page());
    await first;
    expect(api.listContacts).toHaveBeenLastCalledWith(
      A,
      { q: 'ada', mode: 'all', tag: [id(300), id(301)] },
      {},
    );
    expect(useContactsStore.getState().list).toMatchObject({ key: queryKey(next) });
    expect(useContactsStore.getState().list!.items.map((c) => c.id)).toEqual([id(907)]);
  });

  it('reports the missing tag ids and the counts', async () => {
    api.listContacts.mockResolvedValue(
      page({ missing_tag_ids: [id(399)], matching_count: 1, total_count: 120 }),
    );
    await useContactsStore.getState().loadList(A, query, guard);
    expect(useContactsStore.getState().list).toMatchObject({
      missingTagIds: [id(399)],
      matchingCount: 1,
      totalCount: 120,
    });
  });

  it('shows an error when the first read fails, keeps the rows when the next page fails', async () => {
    api.listContacts.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await useContactsStore.getState().loadList(A, query, guard);
    expect(useContactsStore.getState().list?.status).toBe('error');
    api.listContacts.mockResolvedValueOnce(page({ has_next: true, next_cursor: 'c1' }));
    await useContactsStore.getState().loadList(A, query, guard);
    api.listContacts.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await useContactsStore.getState().loadMore(A, guard);
    expect(useContactsStore.getState().list).toMatchObject({ status: 'ready', more: 'error' });
    expect(useContactsStore.getState().list!.items).toHaveLength(2);
  });

  it('hands a 401 or a removed access to the guard', async () => {
    api.listContacts.mockRejectedValueOnce(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'));
    await useContactsStore.getState().loadList(A, query, guard);
    api.listContacts.mockRejectedValueOnce(new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x'));
    await useContactsStore.getState().loadList(A, query, guard);
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('starts empty after a workspace switch', async () => {
    api.listContacts.mockResolvedValue(page());
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useContactsStore
      .getState()
      .loadList(A, { q: 'ada', mode: 'all', tagIds: [id(300)] }, guard);
    useWorkspaceStore.getState().setCurrent({ id: B, name: 'Bolt', role: 'operator' });
    expect(useContactsStore.getState()).toMatchObject({ workspaceId: null, list: null });
  });
});

describe('contacts store: the profile', () => {
  it('reads the contact, its tag history and its conversation (summary then thread)', async () => {
    openEverything();
    await useContactsStore.getState().openProfile(A, C1, guard);
    const s = useContactsStore.getState();
    expect(s.profile).toMatchObject({ status: 'ready', contact: { id: C1 } });
    expect(s.history).toMatchObject({ status: 'ready' });
    expect(s.conversation).toMatchObject({
      status: 'ready',
      thread: 'ready',
      summary: { id: CONV },
    });
    expect(s.conversation!.items.map((i) => i.id)).toEqual([id(501), id(502)]);
    expect(api.listThreadItems).toHaveBeenCalledWith(A, CONV, { limit: 30 }, {});
  });

  it('shows not found for a 404 contact and «none» for a contact with no conversation', async () => {
    api.getContact.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    api.listContactTagHistory.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    api.getContactConversation.mockRejectedValue(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    await useContactsStore.getState().openProfile(A, C1, guard);
    expect(useContactsStore.getState().profile?.status).toBe('not_found');
    api.getContact.mockResolvedValue(profile());
    api.listContactTagHistory.mockResolvedValue(history());
    await useContactsStore.getState().openProfile(A, C1, guard);
    expect(useContactsStore.getState().profile?.status).toBe('ready');
    expect(useContactsStore.getState().conversation).toMatchObject({
      status: 'none',
      summary: null,
    });
  });

  it('pages tag history by after and conversation history by before, without repeats', async () => {
    openEverything();
    api.listContactTagHistory.mockResolvedValue(
      history({
        items: [{ id: id(700) } as never],
        has_next: true,
        next_cursor: 'h1',
      }),
    );
    api.listThreadItems.mockResolvedValue(
      thread([message(3, 3), message(4, 4)], { has_prev: true, prev_cursor: 'p1' }),
    );
    await useContactsStore.getState().openProfile(A, C1, guard);
    api.listContactTagHistory.mockResolvedValueOnce(
      history({ items: [{ id: id(700) } as never, { id: id(701) } as never] }),
    );
    await useContactsStore.getState().loadMoreHistory(A, guard);
    expect(api.listContactTagHistory).toHaveBeenLastCalledWith(A, C1, { after: 'h1' }, {});
    expect(useContactsStore.getState().history!.items.map((e) => e.id)).toEqual([id(700), id(701)]);
    api.listThreadItems.mockResolvedValueOnce(thread([message(1, 1), message(2, 2)]));
    await useContactsStore.getState().loadOlder(A, guard);
    expect(api.listThreadItems).toHaveBeenLastCalledWith(A, CONV, { before: 'p1', limit: 30 });
    const c = useContactsStore.getState().conversation!;
    expect(c.items.map((i) => i.id)).toEqual([id(501), id(502), id(503), id(504)]);
    expect(c.hasPrev).toBe(false);
  });

  it('keeps the shown items when older items fail, and allows a retry', async () => {
    openEverything();
    api.listThreadItems.mockResolvedValue(
      thread([message(3, 3)], { has_prev: true, prev_cursor: 'p1' }),
    );
    await useContactsStore.getState().openProfile(A, C1, guard);
    api.listThreadItems.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await useContactsStore.getState().loadOlder(A, guard);
    expect(useContactsStore.getState().conversation).toMatchObject({ older: 'error' });
    expect(useContactsStore.getState().conversation!.items).toHaveLength(1);
    api.listThreadItems.mockResolvedValueOnce(thread([message(1, 1)]));
    await useContactsStore.getState().loadOlder(A, guard);
    expect(useContactsStore.getState().conversation!.items).toHaveLength(2);
  });

  it('shows an error for each part that fails, the others stay', async () => {
    openEverything();
    api.getContactConversation.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    api.listContactTagHistory.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await useContactsStore.getState().openProfile(A, C1, guard);
    const s = useContactsStore.getState();
    expect(s.profile?.status).toBe('ready');
    expect(s.history?.status).toBe('error');
    expect(s.conversation?.status).toBe('error');
  });
});

describe('contacts store: live frames', () => {
  async function opened() {
    openEverything();
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useContactsStore.getState().openProfile(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    vi.clearAllMocks();
    openEverything();
  }

  it('contact.changed for the shown contact re-reads the contact and the tag history from the top', async () => {
    await opened();
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 1, conversation: 0, items: 0 });
    expect(api.getContact).toHaveBeenLastCalledWith(A, C1, { background: true });
    expect(api.listContactTagHistory).toHaveBeenLastCalledWith(A, C1, {}, { background: true });
  });

  it('contact.changed for another contact is ignored', async () => {
    await opened();
    emit(frame({ type: 'contact.changed', contact_id: C2, change: 'tags' }));
    await settle();
    expect(calls()).toEqual({ contact: 0, history: 0, conversation: 0, items: 0 });
  });

  it('tags.changed re-reads the shown contact and its tag history', async () => {
    await opened();
    emit(frame({ type: 'tags.changed' }));
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 1, conversation: 0, items: 0 });
  });

  it('conversation.changed for the profile conversation re-reads the summary, the items and the contact, and never marks read', async () => {
    await opened();
    api.getContactConversation.mockResolvedValue(
      summary({ assignee: { account_id: id(800), display_name: 'Tim' }, waiting_for_reply: false }),
    );
    api.listThreadItems.mockResolvedValue(thread([message(1, 1), message(2, 2), message(3, 3)]));
    api.getContact.mockResolvedValue(profile(C1, { first_name: 'Ada B.' }));
    emit(
      frame({
        type: 'conversation.changed',
        conversation_id: CONV,
        item: { type: 'message', id: id(503) },
        change: 'created',
      }),
    );
    await settle();
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 0, conversation: 1, items: 1 });
    const s = useContactsStore.getState();
    expect(s.conversation!.items.map((i) => i.id)).toEqual([id(501), id(502), id(503)]);
    expect(s.conversation!.summary).toMatchObject({
      waiting_for_reply: false,
      assignee: { display_name: 'Tim' },
    });
    expect(s.profile!.contact!.first_name).toBe('Ada B.');
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('conversation.changed for another conversation is ignored', async () => {
    await opened();
    emit(
      frame({
        type: 'conversation.changed',
        conversation_id: id(102),
        item: null,
        change: 'state',
      }),
    );
    await settle();
    expect(calls()).toEqual({ contact: 0, history: 0, conversation: 0, items: 0 });
  });

  it('a frame of another workspace is dropped', async () => {
    await opened();
    emit(frame({ type: 'tags.changed', workspace_id: B }));
    emit(frame({ type: 'contact.changed', workspace_id: B, contact_id: C1, change: 'tags' }));
    emit(frame({ type: 'resync', workspace_id: B }));
    await settle();
    expect(calls()).toEqual({ contact: 0, history: 0, conversation: 0, items: 0 });
  });

  it('resync and a reconnect re-read everything that is open', async () => {
    await opened();
    emit(frame({ type: 'resync' }));
    await settle();
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 1, conversation: 1, items: 1 });
    vi.clearAllMocks();
    openEverything();
    (live.subs[0]!.subscriber.onReconnected as () => void)();
    await settle();
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 1, conversation: 1, items: 1 });
  });

  it('a failed background re-read keeps what is shown and the next frame asks again', async () => {
    await opened();
    api.getContact.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    api.listContactTagHistory.mockRejectedValueOnce(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'),
    );
    emit(frame({ type: 'tags.changed' }));
    await settle();
    expect(useContactsStore.getState().profile).toMatchObject({ status: 'ready' });
    expect(useContactsStore.getState().profile!.contact).not.toBeNull();
    expect(useContactsStore.getState().history?.status).toBe('ready');
    api.getContact.mockResolvedValue(profile(C1, { first_name: 'Ada C.' }));
    emit(frame({ type: 'tags.changed' }));
    await settle();
    expect(useContactsStore.getState().profile!.contact!.first_name).toBe('Ada C.');
  });

  it('follows the header contact on contact.changed and tags.changed, not another contact', async () => {
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    api.getContact.mockResolvedValue(profile(C1));
    await useContactsStore.getState().openHeader(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    api.getContact.mockClear();
    emit(frame({ type: 'contact.changed', contact_id: C2, change: 'tags' }));
    await settle();
    expect(api.getContact).not.toHaveBeenCalled();
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    emit(frame({ type: 'tags.changed' }));
    await settle();
    expect(api.getContact).toHaveBeenCalledTimes(2);
    expect(api.listContactTagHistory).not.toHaveBeenCalled();
  });

  it('stops listening when the returned function is called', async () => {
    await opened();
    useContactsStore.getState().watch(A, guard)();
    expect(live.subs).toHaveLength(1);
  });
});

describe('contacts store: overlapping re-reads (AC-06, AC-13)', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  async function opened() {
    openEverything();
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useContactsStore.getState().openProfile(A, C1, guard);
    await useContactsStore.getState().openHeader(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    vi.clearAllMocks();
  }
  const tagged = (name: string) =>
    profile(C1, {
      tags: [
        {
          id: id(300),
          name,
          added_by: { account_id: id(800), display_name: 'Test User' },
          added_at: at(1),
        },
      ],
    });
  const changed = frame({
    type: 'conversation.changed',
    conversation_id: CONV,
    item: { type: 'message', id: id(503) },
    change: 'created',
  });

  it('two contact re-reads answering in reverse order: the newer answer stays', async () => {
    await opened();
    const older = deferred<ContactProfile>();
    const newer = deferred<ContactProfile>();
    api.getContact
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
      .mockReturnValueOnce(newer.promise);
    api.listContactTagHistory.mockResolvedValue(history());
    emit(frame({ type: 'tags.changed' }));
    emit(frame({ type: 'tags.changed' }));
    newer.resolve(tagged('VIP'));
    await settle();
    older.resolve(profile());
    await settle();
    expect(useContactsStore.getState().profile!.contact!.tags.map((t) => t.name)).toEqual(['VIP']);
    expect(useContactsStore.getState().header!.contact!.tags.map((t) => t.name)).toEqual(['VIP']);
  });

  it('two tag-history re-reads answering in reverse order: the newer answer stays', async () => {
    await opened();
    const older = deferred<TagHistoryPage>();
    const newer = deferred<TagHistoryPage>();
    api.getContact.mockResolvedValue(profile());
    api.listContactTagHistory.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    newer.resolve(history({ items: [{ id: id(702) } as never, { id: id(701) } as never] }));
    await settle();
    older.resolve(history({ items: [{ id: id(701) } as never] }));
    await settle();
    expect(useContactsStore.getState().history!.items.map((e) => e.id)).toEqual([id(702), id(701)]);
  });

  it('two conversation summary re-reads answering in reverse order: the newer summary stays', async () => {
    await opened();
    const olderSummary = deferred<ConversationSummary>();
    const newerSummary = deferred<ConversationSummary>();
    api.getContact.mockResolvedValue(profile());
    api.getContactConversation
      .mockReturnValueOnce(olderSummary.promise)
      .mockReturnValueOnce(newerSummary.promise);
    api.listThreadItems.mockResolvedValue(thread([message(1, 1), message(2, 2)]));
    emit(changed);
    emit(changed);
    newerSummary.resolve(summary({ unread_count: 3, status: 'closed' }));
    await settle();
    olderSummary.resolve(summary({ unread_count: 2 }));
    await settle();
    expect(useContactsStore.getState().conversation!.summary!.status).toBe('closed');
  });

  it('two thread re-reads answering in reverse order: the newer items stay', async () => {
    await opened();
    api.getContact.mockResolvedValue(profile());
    api.getContactConversation.mockResolvedValue(summary());
    const olderItems = deferred<ThreadPage>();
    const newerItems = deferred<ThreadPage>();
    api.listThreadItems
      .mockReturnValueOnce(olderItems.promise)
      .mockReturnValueOnce(newerItems.promise);
    emit(changed);
    await settle();
    emit(changed);
    await settle();
    expect(api.listThreadItems).toHaveBeenCalledTimes(2);
    const edited = { ...message(2, 2), body: 'm2 edited' } as ThreadMessage;
    newerItems.resolve(thread([message(1, 1), edited]));
    await settle();
    olderItems.resolve(thread([message(1, 1), message(2, 2)]));
    await settle();
    const items = useContactsStore.getState().conversation!.items;
    expect(items.map((i) => (i as ThreadMessage).body)).toEqual(['m1', 'm2 edited']);
  });

  it('a next history page answering after a first-page re-read moved the cursor is dropped', async () => {
    openEverything();
    api.listContactTagHistory.mockResolvedValue(
      history({ items: [{ id: id(710) } as never], has_next: true, next_cursor: 'h1' }),
    );
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useContactsStore.getState().openProfile(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    const more = deferred<TagHistoryPage>();
    api.listContactTagHistory.mockReturnValueOnce(more.promise);
    const loading = useContactsStore.getState().loadMoreHistory(A, guard);
    // a new entry arrives: the first page now ends one entry later
    api.listContactTagHistory.mockResolvedValueOnce(
      history({
        items: [{ id: id(711) } as never, { id: id(710) } as never],
        has_next: true,
        next_cursor: 'h2',
      }),
    );
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    await settle();
    // the page after h1 starts with the entry the fresh first page already ends with's successor
    more.resolve(history({ items: [{ id: id(709) } as never], has_next: true, next_cursor: 'h3' }));
    await loading;
    const h = useContactsStore.getState().history!;
    expect(h.items.map((e) => e.id)).toEqual([id(711), id(710)]);
    expect(h.nextCursor).toBe('h2');
    expect(h.more).toBe('idle');
  });
});

describe('contacts store never marks read (ADR-0006, AC-05)', () => {
  it('issues no mark-read request on any path: open, page, retry, live, close', async () => {
    openEverything();
    api.listThreadItems.mockResolvedValue(
      thread([message(3, 3)], { has_prev: true, prev_cursor: 'p1' }),
    );
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    api.listContacts.mockResolvedValue(page());
    await useContactsStore.getState().loadList(A, query, guard);
    await useContactsStore.getState().openProfile(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    await useContactsStore.getState().loadOlder(A, guard);
    await useContactsStore.getState().retryConversation(A, guard);
    emit(
      frame({
        type: 'conversation.changed',
        conversation_id: CONV,
        item: { type: 'message', id: id(509) },
        change: 'created',
      }),
    );
    emit(frame({ type: 'resync' }));
    await settle();
    await settle();
    useContactsStore.getState().closeProfile();
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  it('has no reference to the mark-read route in the contacts or tags sources', () => {
    const sources = import.meta.glob(['./*.ts', './*.tsx', '../tags/*.ts', '../tags/*.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([, text]) => text.includes('markConversationRead') || text.includes('/read`'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('contacts store: a superseded success is not lost (RR1)', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const failure = () => new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x');
  function opening() {
    openEverything();
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    useContactsStore.getState().watch(A, guard);
  }

  it('the contact: an older open read succeeds, the newer background read fails → the older answer shows', async () => {
    opening();
    const first = deferred<ContactProfile>();
    const second = deferred<ContactProfile>();
    api.getContact.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const open = useContactsStore.getState().openProfile(A, C1, guard);
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    first.resolve(profile(C1, { first_name: 'Ada F.' }));
    await settle();
    second.reject(failure());
    await open;
    await settle();
    expect(useContactsStore.getState().profile).toMatchObject({
      status: 'ready',
      contact: { first_name: 'Ada F.' },
    });
  });

  it('the contact: the newer read fails first, the older success arrives after → the older answer shows', async () => {
    opening();
    const first = deferred<ContactProfile>();
    api.getContact
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(Promise.reject(failure()));
    const open = useContactsStore.getState().openProfile(A, C1, guard);
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    await settle();
    first.resolve(profile(C1, { first_name: 'Ada F.' }));
    await open;
    expect(useContactsStore.getState().profile).toMatchObject({
      status: 'ready',
      contact: { first_name: 'Ada F.' },
    });
  });

  it('the tag history: an older open read succeeds, the newer background read fails → the older entries show', async () => {
    opening();
    const first = deferred<TagHistoryPage>();
    const second = deferred<TagHistoryPage>();
    api.listContactTagHistory
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const open = useContactsStore.getState().openProfile(A, C1, guard);
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    first.resolve(history({ items: [{ id: id(701) } as never] }));
    await settle();
    second.reject(failure());
    await open;
    await settle();
    const h = useContactsStore.getState().history!;
    expect(h.status).toBe('ready');
    expect(h.items.map((e) => e.id)).toEqual([id(701)]);
  });

  it('the conversation summary: an older open read succeeds, the newer background read fails → the older summary and its thread show', async () => {
    opening();
    const first = deferred<ConversationSummary>();
    const second = deferred<ConversationSummary>();
    api.getContactConversation
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const open = useContactsStore.getState().openProfile(A, C1, guard);
    emit(frame({ type: 'resync' }));
    first.resolve(summary());
    await settle();
    second.reject(failure());
    await open;
    await settle();
    await settle();
    const c = useContactsStore.getState().conversation!;
    expect(c.status).toBe('ready');
    expect(c.summary?.id).toBe(CONV);
    expect(c.thread).toBe('ready');
    expect(c.items.map((i) => i.id)).toEqual([id(501), id(502)]);
  });

  it('the thread: an older open read succeeds, the newer background read fails → the older items show', async () => {
    opening();
    const first = deferred<ThreadPage>();
    const second = deferred<ThreadPage>();
    api.listThreadItems.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const open = useContactsStore.getState().openProfile(A, C1, guard);
    await settle();
    expect(api.listThreadItems).toHaveBeenCalledTimes(1);
    emit(
      frame({
        type: 'conversation.changed',
        conversation_id: CONV,
        item: { type: 'message', id: id(503) },
        change: 'created',
      }),
    );
    await settle();
    expect(api.listThreadItems).toHaveBeenCalledTimes(2);
    first.resolve(thread([message(1, 1), message(2, 2)]));
    await settle();
    second.reject(failure());
    await open;
    await settle();
    const c = useContactsStore.getState().conversation!;
    expect(c.thread).toBe('ready');
    expect(c.items.map((i) => i.id)).toEqual([id(501), id(502)]);
  });
});

describe('contacts store: a held answer never replaces a newer write (RR3)', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const tag = (n: number, name: string) => ({
    id: id(n),
    name,
    added_by: { account_id: id(800), display_name: 'Test User' },
    added_at: at(1),
  });
  async function opened() {
    openEverything();
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useContactsStore.getState().openProfile(A, C1, guard);
    await useContactsStore.getState().openHeader(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    vi.clearAllMocks();
    guard.mockResolvedValue('handled');
  }
  /** R1 (profile + header) answers and is held while R2 (profile + header) is still in flight. */
  async function heldThenNewest() {
    const r1 = deferred<ContactProfile>();
    const r2 = deferred<ContactProfile>();
    api.getContact
      .mockReturnValueOnce(r1.promise)
      .mockReturnValueOnce(r1.promise)
      .mockReturnValueOnce(r2.promise)
      .mockReturnValueOnce(r2.promise);
    const reads = Promise.all([
      useContactsStore.getState().rereadContact(A, C1, guard),
      useContactsStore.getState().rereadContact(A, C1, guard),
    ]);
    r1.resolve(profile(C1, { first_name: 'Ada Old', tags: [tag(300, 'Old')] }));
    await settle();
    return { r2, reads };
  }
  const names = (slice: 'profile' | 'header') =>
    useContactsStore.getState()[slice]!.contact!.tags.map((t) => t.name);

  it('a tag added while R1 is held: R2 then fails → the added tag stays (profile and header)', async () => {
    await opened();
    const { r2, reads } = await heldThenNewest();
    // R2 was in flight: the fresh re-read the write starts fails too (a failure keeps what shows)
    api.getContact.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    useContactsStore.getState().applyTags(A, C1, [tag(301, 'New')], guard);
    r2.reject(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await reads;
    await settle();
    expect(names('profile')).toEqual(['New']);
    expect(names('header')).toEqual(['New']);
  });

  it('a re-read in flight when a tag is added: a fresh re-read is issued and its answer (with a teammate tag) shows (RR5)', async () => {
    await opened();
    api.listContactTagHistory.mockResolvedValue(history());
    const inFlight = deferred<ContactProfile>();
    const withMate = profile(C1, { tags: [tag(301, 'New'), tag(302, 'Mate')] });
    api.getContact
      .mockReturnValueOnce(inFlight.promise)
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValue(withMate);
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'tags' }));
    expect(api.getContact).toHaveBeenCalledTimes(2);
    useContactsStore.getState().applyTags(A, C1, [tag(301, 'New')], guard);
    expect(api.getContact).toHaveBeenCalledTimes(4);
    inFlight.resolve(withMate);
    await settle();
    await settle();
    expect(names('profile')).toEqual(['New', 'Mate']);
    expect(names('header')).toEqual(['New', 'Mate']);
  });

  it('nothing in flight when a tag is added: no extra contact read (RR5)', async () => {
    await opened();
    useContactsStore.getState().applyTags(A, C1, [tag(301, 'New')], guard);
    await settle();
    expect(api.getContact).not.toHaveBeenCalled();
    expect(names('profile')).toEqual(['New']);
    expect(names('header')).toEqual(['New']);
  });

  it('the newest read answers 404 while R1 is held → not found, the held answer does not show', async () => {
    await opened();
    const { r2, reads } = await heldThenNewest();
    r2.reject(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    await reads;
    await settle();
    expect(useContactsStore.getState().profile).toMatchObject({
      status: 'not_found',
      contact: null,
    });
    expect(useContactsStore.getState().header).toMatchObject({
      status: 'not_found',
      contact: null,
    });
  });

  it.each([401, 403])(
    'the newest read answers %i while R1 is held → the guard takes over, the held answer does not show',
    async (status) => {
      await opened();
      const before = useContactsStore.getState().profile!.contact!;
      const { r2, reads } = await heldThenNewest();
      r2.reject(
        new ApiError(
          status,
          status === 401 ? ErrorCode.UNAUTHENTICATED : ErrorCode.ACCESS_REMOVED,
          'x',
        ),
      );
      await reads;
      await settle();
      expect(guard).toHaveBeenCalled();
      expect(useContactsStore.getState().profile!.contact).toEqual(before);
      expect(useContactsStore.getState().header!.contact).toEqual(before);
    },
  );
});

describe('contacts store: reach marks live (AC-14)', () => {
  it('contact.changed reach re-reads the list page when the contact is on it, not otherwise', async () => {
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    api.listContacts.mockResolvedValue(page({ items: [row(1), row(2)] }));
    await useContactsStore.getState().loadList(A, query, guard);
    useContactsStore.getState().watch(A, guard);
    api.listContacts.mockClear();
    emit(frame({ type: 'contact.changed', contact_id: id(999), change: 'reach' }));
    await settle();
    expect(api.listContacts).not.toHaveBeenCalled();
    api.listContacts.mockResolvedValue(page({ items: [row(1, { blocked_since: at(9) }), row(2)] }));
    emit(frame({ type: 'contact.changed', contact_id: id(901), change: 'reach' }));
    await settle();
    await settle();
    expect(api.listContacts).toHaveBeenCalledTimes(1);
    expect(api.listContacts).toHaveBeenLastCalledWith(
      A,
      { q: '', mode: 'any', tag: [] },
      { background: true },
    );
    expect(useContactsStore.getState().list!.items[0]!.blocked_since).toBe(at(9));
  });

  it('keeps the rows of every shown page when it re-reads', async () => {
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    api.listContacts.mockResolvedValueOnce(
      page({ items: [row(1)], has_next: true, next_cursor: 'c1' }),
    );
    await useContactsStore.getState().loadList(A, query, guard);
    api.listContacts.mockResolvedValueOnce(page({ items: [row(2)] }));
    await useContactsStore.getState().loadMore(A, guard);
    useContactsStore.getState().watch(A, guard);
    api.listContacts.mockReset();
    api.listContacts
      .mockResolvedValueOnce(page({ items: [row(1)], has_next: true, next_cursor: 'c1' }))
      .mockResolvedValueOnce(page({ items: [row(2, { blocked_since: at(9) })] }));
    emit(frame({ type: 'contact.changed', contact_id: id(902), change: 'reach' }));
    await settle();
    await settle();
    await settle();
    const list = useContactsStore.getState().list!;
    expect(list.items.map((c) => c.id)).toEqual([id(901), id(902)]);
    expect(list.items[1]!.blocked_since).toBe(at(9));
  });

  it('tags changes still never re-read the list', async () => {
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    api.listContacts.mockResolvedValue(page());
    await useContactsStore.getState().loadList(A, query, guard);
    useContactsStore.getState().watch(A, guard);
    api.listContacts.mockClear();
    emit(frame({ type: 'contact.changed', contact_id: id(901), change: 'tags' }));
    emit(frame({ type: 'tags.changed' }));
    await settle();
    expect(api.listContacts).not.toHaveBeenCalled();
  });

  it('reach for the open profile re-reads getContact only', async () => {
    openEverything();
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    await useContactsStore.getState().openProfile(A, C1, guard);
    useContactsStore.getState().watch(A, guard);
    vi.clearAllMocks();
    openEverything();
    emit(frame({ type: 'contact.changed', contact_id: C1, change: 'reach' }));
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 0, conversation: 0, items: 0 });
    emit(frame({ type: 'contact.changed', contact_id: C2, change: 'reach' }));
    await settle();
    expect(calls()).toEqual({ contact: 1, history: 0, conversation: 0, items: 0 });
  });
});
