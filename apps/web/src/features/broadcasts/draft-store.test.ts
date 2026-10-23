import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type BroadcastDraft,
  type BroadcastGroupChange,
  type LaunchedBroadcast,
  type LiveFrame,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';

const api = vi.hoisted(() => ({
  getBroadcast: vi.fn(),
  saveBroadcastFields: vi.fn(),
  saveBroadcastAudience: vi.fn(),
  listBroadcastGroup: vi.fn(),
  addBroadcastGroupContact: vi.fn(),
  removeBroadcastGroupContact: vi.fn(),
}));
vi.mock('./api', () => ({
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  saveBroadcastFields: (...a: unknown[]) => api.saveBroadcastFields(...a),
  saveBroadcastAudience: (...a: unknown[]) => api.saveBroadcastAudience(...a),
  listBroadcastGroup: (...a: unknown[]) => api.listBroadcastGroup(...a),
  addBroadcastGroupContact: (...a: unknown[]) => api.addBroadcastGroupContact(...a),
  removeBroadcastGroupContact: (...a: unknown[]) => api.removeBroadcastGroupContact(...a),
}));
const live = vi.hoisted(() => ({
  subs: [] as { workspaceId: string; subscriber: Record<string, (...a: never[]) => void> }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (workspaceId: string, subscriber: Record<string, (...a: never[]) => void>) => {
    const entry = { workspaceId, subscriber };
    live.subs.push(entry);
    return () => {
      live.subs = live.subs.filter((e) => e !== entry);
    };
  },
}));

import { useBroadcastDraftStore } from './draft-store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const BC = '0198f0c0-0000-7000-8000-000000000301';
const C1 = '0198f0c0-0000-7000-8000-000000000901';
const C2 = '0198f0c0-0000-7000-8000-000000000902';
const member = { account_id: '0198f0c0-0000-7000-8000-000000000501', display_name: 'Test User' };
const guard = vi.fn();
const settle = () => new Promise((r) => setTimeout(r, 0));

const draft = (version = 1, o: Partial<BroadcastDraft> = {}): BroadcastDraft => ({
  id: BC,
  workspace_id: A,
  name: 'Spring prices',
  author: member,
  last_changed_by: member,
  last_changed_at: '2026-10-20T10:00:00.000Z',
  created_at: '2026-10-20T09:00:00.000Z',
  status: 'draft',
  version,
  text: 'Hello',
  audience: { kind: 'group', size: 1 },
  breakdown: {
    audience_size: 1,
    reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 1 },
  },
  ...o,
});
const launched = (): LaunchedBroadcast => ({
  id: BC,
  workspace_id: A,
  name: 'Spring prices',
  author: member,
  last_changed_by: member,
  last_changed_at: '2026-10-20T10:00:00.000Z',
  created_at: '2026-10-20T09:00:00.000Z',
  status: 'sending',
  text: 'Hello',
  audience: { kind: 'group' },
  launched_by: member,
  launched_at: '2026-10-20T10:00:00.000Z',
  launch_breakdown: {
    audience_size: 1,
    blocked_count: 0,
    never_wrote_count: 0,
    recipient_count: 1,
  },
  stopped_by: null,
  stopped_at: null,
  ended_at: null,
  end_reason: null,
  totals: {
    waiting: 1,
    sending: 0,
    delivered: 0,
    blocked: 0,
    failed: 0,
    not_confirmed: 0,
    stopped: 0,
  },
  not_reached_count: 0,
});
const frame = (o: Partial<Extract<LiveFrame, { type: 'broadcast.changed' }>> = {}): LiveFrame => ({
  type: 'broadcast.changed',
  v: 1,
  workspace_id: A,
  broadcast_id: BC,
  change: 'draft',
  ...o,
});
const emit = (f: LiveFrame) => live.subs.forEach((s) => s.subscriber.onFrame!(f as never));
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const store = () => useBroadcastDraftStore.getState();

async function opened(d = draft()) {
  api.getBroadcast.mockResolvedValue(d);
  await store().open(A, BC, guard);
  const stop = store().watch(A, guard);
  api.getBroadcast.mockClear();
  return stop;
}

beforeEach(() => {
  vi.clearAllMocks();
  live.subs = [];
  store().close();
  store().forget();
});

describe('broadcast draft store (SCR-25)', () => {
  it('opens a draft', async () => {
    await opened();
    expect(store()).toMatchObject({
      workspaceId: A,
      broadcastId: BC,
      status: 'ready',
      draft: draft(),
    });
  });

  it('opens a launched broadcast as launched', async () => {
    api.getBroadcast.mockResolvedValue(launched());
    await store().open(A, BC, guard);
    expect(store()).toMatchObject({ status: 'launched', launched: launched() });
  });

  it('sends one save at a time with the version it holds and replays a change made meanwhile on the new version', async () => {
    await opened();
    const first = deferred<BroadcastDraft>();
    api.saveBroadcastFields
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(draft(3, { name: 'Spring sale', text: 'Hi there' }));
    store().editFields({ text: 'Hi' }, guard);
    await settle();
    expect(store().save).toBe('saving');
    store().editFields({ text: 'Hi there' }, guard);
    store().editFields({ name: 'Spring sale' }, guard);
    await settle();
    expect(api.saveBroadcastFields).toHaveBeenCalledTimes(1);
    expect(api.saveBroadcastFields).toHaveBeenLastCalledWith(A, BC, {
      expected_version: 1,
      text: 'Hi',
    });
    first.resolve(draft(2, { text: 'Hi' }));
    await settle();
    await settle();
    expect(api.saveBroadcastFields).toHaveBeenCalledTimes(2);
    expect(api.saveBroadcastFields).toHaveBeenLastCalledWith(A, BC, {
      expected_version: 2,
      text: 'Hi there',
      name: 'Spring sale',
    });
    await settle();
    expect(store()).toMatchObject({
      save: 'saved',
      draft: { version: 3, text: 'Hi there' },
      unsent: {},
    });
  });

  it('BROADCAST_DRAFT_CHANGED keeps the member’s own edit beside the teammate’s version', async () => {
    await opened();
    const theirs = draft(2, { text: 'Teammate text', name: 'Teammate name' });
    api.saveBroadcastFields.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', { draft: theirs }),
    );
    store().editFields({ text: 'My text' }, guard);
    await settle();
    await settle();
    expect(store()).toMatchObject({
      draft: theirs,
      stale: { theirs, mine: { text: 'My text' } },
      unsent: {},
    });
    api.saveBroadcastFields.mockResolvedValueOnce(
      draft(3, { text: 'My text', name: 'Teammate name' }),
    );
    store().useMine(guard);
    await settle();
    await settle();
    expect(api.saveBroadcastFields).toHaveBeenLastCalledWith(A, BC, {
      expected_version: 2,
      text: 'My text',
    });
    expect(store()).toMatchObject({ stale: null, draft: { version: 3, text: 'My text' } });
  });

  it('keep theirs drops the member’s edit', async () => {
    await opened();
    const theirs = draft(2, { text: 'Teammate text' });
    api.saveBroadcastFields.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_DRAFT_CHANGED, 'changed', { draft: theirs }),
    );
    store().editFields({ text: 'My text' }, guard);
    await settle();
    await settle();
    store().keepTheirs();
    expect(store()).toMatchObject({ stale: null, draft: theirs });
    expect(api.saveBroadcastFields).toHaveBeenCalledTimes(1);
  });

  it('BROADCAST_NOT_A_DRAFT marks it launched with the re-read broadcast', async () => {
    await opened();
    api.saveBroadcastFields.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_NOT_A_DRAFT, 'launched', {
        broadcast_id: BC,
        status: 'sending',
      }),
    );
    api.getBroadcast.mockResolvedValue(launched());
    store().editFields({ text: 'Late' }, guard);
    await settle();
    await settle();
    await settle();
    expect(store()).toMatchObject({ status: 'launched', launched: launched() });
  });

  it('a failed save keeps the edit for Retry; a 401 keeps it for the same address', async () => {
    await opened();
    api.saveBroadcastFields.mockRejectedValueOnce(
      new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'),
    );
    store().editFields({ text: 'Kept' }, guard);
    await settle();
    await settle();
    expect(store()).toMatchObject({ save: 'failed', unsent: { text: 'Kept' } });
    const unauth = new ApiError(401, ErrorCode.UNAUTHENTICATED, 'sign in');
    api.saveBroadcastFields.mockRejectedValueOnce(unauth);
    store().retry(guard);
    await settle();
    await settle();
    expect(guard).toHaveBeenCalledWith(unauth, A);
    expect(store().unsent).toEqual({ text: 'Kept' });
    // Back on the same address after signing in: the unsent edit is still there and goes out.
    store().close();
    api.getBroadcast.mockResolvedValue(draft());
    api.saveBroadcastFields.mockResolvedValueOnce(draft(2, { text: 'Kept' }));
    await store().open(A, BC, guard);
    expect(store().unsent).toEqual({ text: 'Kept' });
    store().retry(guard);
    await settle();
    await settle();
    expect(api.saveBroadcastFields).toHaveBeenLastCalledWith(A, BC, {
      expected_version: 1,
      text: 'Kept',
    });
    expect(store().unsent).toEqual({});
  });

  it('saves the audience through the same queue, with the version it holds', async () => {
    await opened();
    api.saveBroadcastAudience.mockResolvedValueOnce(
      draft(2, { audience: { kind: 'tags', mode: 'any', tags: [], dropped_tags: [] } }),
    );
    store().saveAudience({ kind: 'tags', mode: 'any', tag_ids: [], exclude_tag_ids: [] }, guard);
    await settle();
    await settle();
    expect(api.saveBroadcastAudience).toHaveBeenCalledWith(A, BC, {
      expected_version: 1,
      kind: 'tags',
      mode: 'any',
      tag_ids: [],
      exclude_tag_ids: [],
    });
    expect(store().draft!.version).toBe(2);
  });

  it('acts on status and deleted frames only; draft and group frames never re-read the open draft', async () => {
    await opened();
    emit(frame({ change: 'draft' }));
    emit(frame({ change: 'group' }));
    emit(frame({ change: 'report' }));
    emit(frame({ change: 'status', workspace_id: B }));
    emit(frame({ change: 'status', broadcast_id: C1 }));
    await settle();
    expect(api.getBroadcast).not.toHaveBeenCalled();
    api.getBroadcast.mockResolvedValue(launched());
    emit(frame({ change: 'status' }));
    await settle();
    await settle();
    expect(api.getBroadcast).toHaveBeenCalledWith(A, BC, { background: true });
    expect(store()).toMatchObject({ status: 'launched', launched: launched() });
  });

  it('a deleted frame shows not found', async () => {
    await opened();
    emit(frame({ change: 'deleted' }));
    await settle();
    expect(store().status).toBe('not_found');
  });

  it('sends group adds and removes one by one and follows the group size', async () => {
    await opened();
    const first = deferred<BroadcastGroupChange>();
    api.addBroadcastGroupContact.mockReturnValueOnce(first.promise);
    api.removeBroadcastGroupContact.mockResolvedValueOnce({
      broadcast_id: BC,
      outcome: 'removed',
      group_size: 1,
    });
    api.listBroadcastGroup.mockResolvedValue({
      workspace_id: A,
      broadcast_id: BC,
      size: 1,
      items: [],
      has_prev: false,
      has_next: false,
      next_cursor: null,
    });
    const add = store().addContact(C1, guard);
    const remove = store().removeContact(C2, guard);
    await settle();
    expect(api.addBroadcastGroupContact).toHaveBeenCalledTimes(1);
    expect(api.removeBroadcastGroupContact).not.toHaveBeenCalled();
    first.resolve({ broadcast_id: BC, outcome: 'added', group_size: 2 });
    expect(await add).toMatchObject({ outcome: 'added', group_size: 2 });
    expect(await remove).toMatchObject({ outcome: 'removed', group_size: 1 });
    expect(api.addBroadcastGroupContact).toHaveBeenCalledWith(A, BC, { contact_id: C1 });
    expect(api.removeBroadcastGroupContact).toHaveBeenCalledWith(A, BC, C2);
    expect(store().draft!.audience).toEqual({ kind: 'group', size: 1 });
    // Group writes stay outside the version: the next field save still carries version 1.
    expect(store().draft!.version).toBe(1);
  });
});
