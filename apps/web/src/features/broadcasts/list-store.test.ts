import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type BroadcastList, type LiveFrame } from '@tg/shared';
import { ApiError } from '@/shared/api/client';

const api = vi.hoisted(() => ({ listBroadcasts: vi.fn() }));
vi.mock('./api', () => ({ listBroadcasts: (...a: unknown[]) => api.listBroadcasts(...a) }));
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

import { useBroadcastListStore } from './list-store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const BC = '0198f0c0-0000-7000-8000-000000000301';
const member = { account_id: '0198f0c0-0000-7000-8000-000000000501', display_name: 'Test User' };
const guard = vi.fn();
const settle = () => new Promise((r) => setTimeout(r, 0));

const list = (name = 'Spring prices'): BroadcastList => ({
  workspace_id: A,
  items: [
    {
      id: BC,
      name,
      status: 'draft',
      audience_kind: 'tags',
      audience_size: 38,
      author: member,
      last_changed_by: member,
      last_changed_at: '2026-10-20T10:00:00.000Z',
      launched_at: null,
      ended_at: null,
    },
  ],
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

beforeEach(() => {
  vi.clearAllMocks();
  live.subs = [];
  useBroadcastListStore.getState().clear();
});

describe('broadcasts list store (SCR-24)', () => {
  it('loads the list of the workspace', async () => {
    api.listBroadcasts.mockResolvedValue(list());
    await useBroadcastListStore.getState().load(A, guard);
    expect(useBroadcastListStore.getState()).toMatchObject({
      workspaceId: A,
      status: 'ready',
      items: list().items,
    });
    expect(api.listBroadcasts).toHaveBeenCalledWith(A, {});
  });

  it('re-reads on any broadcast.changed of the workspace, one fetch in flight and one queued', async () => {
    api.listBroadcasts.mockResolvedValue(list());
    await useBroadcastListStore.getState().load(A, guard);
    const stop = useBroadcastListStore.getState().watch(A, guard);
    const first = deferred<BroadcastList>();
    api.listBroadcasts.mockReset();
    api.listBroadcasts.mockReturnValueOnce(first.promise).mockResolvedValue(list('Renamed'));
    emit(frame({ change: 'status' }));
    emit(frame({ change: 'report' }));
    emit(frame({ change: 'deleted' }));
    emit(frame({ change: 'group' }));
    await settle();
    expect(api.listBroadcasts).toHaveBeenCalledTimes(1);
    expect(api.listBroadcasts).toHaveBeenLastCalledWith(A, { background: true });
    first.resolve(list('Mid'));
    await settle();
    await settle();
    expect(api.listBroadcasts).toHaveBeenCalledTimes(2);
    expect(useBroadcastListStore.getState().items[0]!.name).toBe('Renamed');
    stop();
  });

  it('drops a frame of another workspace', async () => {
    api.listBroadcasts.mockResolvedValue(list());
    await useBroadcastListStore.getState().load(A, guard);
    useBroadcastListStore.getState().watch(A, guard);
    api.listBroadcasts.mockClear();
    emit(frame({ workspace_id: B }));
    await settle();
    expect(api.listBroadcasts).not.toHaveBeenCalled();
  });

  it('re-reads on resync and after a reconnect', async () => {
    api.listBroadcasts.mockResolvedValue(list());
    await useBroadcastListStore.getState().load(A, guard);
    useBroadcastListStore.getState().watch(A, guard);
    api.listBroadcasts.mockClear();
    emit({ type: 'resync', v: 1, workspace_id: A } as LiveFrame);
    await settle();
    expect(api.listBroadcasts).toHaveBeenCalledTimes(1);
    live.subs.forEach((s) => s.subscriber.onReconnected!());
    await settle();
    expect(api.listBroadcasts).toHaveBeenCalledTimes(2);
  });

  it('keeps what is shown when a background re-read fails, with no error', async () => {
    api.listBroadcasts.mockResolvedValue(list());
    await useBroadcastListStore.getState().load(A, guard);
    useBroadcastListStore.getState().watch(A, guard);
    api.listBroadcasts.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'));
    emit(frame());
    await settle();
    await settle();
    expect(useBroadcastListStore.getState()).toMatchObject({
      status: 'ready',
      items: list().items,
    });
    expect(guard).not.toHaveBeenCalled();
  });

  it('hands a 401 of the first read to the guard and shows the error state otherwise', async () => {
    const unauth = new ApiError(401, ErrorCode.UNAUTHENTICATED, 'sign in');
    api.listBroadcasts.mockRejectedValue(unauth);
    await useBroadcastListStore.getState().load(A, guard);
    expect(guard).toHaveBeenCalledWith(unauth, A);
    api.listBroadcasts.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'));
    await useBroadcastListStore.getState().load(A, guard);
    expect(useBroadcastListStore.getState().status).toBe('error');
  });
});
