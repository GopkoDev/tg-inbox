import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type LiveFrame } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import type { LiveSubscriber } from '@/shared/api/live-connection';

const api = vi.hoisted(() => ({ getAttentionCount: vi.fn() }));
vi.mock('./api', () => ({
  getAttentionCount: (...a: unknown[]) => api.getAttentionCount(...a),
}));
const live = vi.hoisted(() => ({
  subs: [] as { workspaceId: string; subscriber: unknown; off: () => void }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  subscribeLive: (workspaceId: string, subscriber: unknown) => {
    const entry = {
      workspaceId,
      subscriber,
      off: vi.fn(() => {
        live.subs = live.subs.filter((s) => s !== entry);
      }),
    };
    live.subs.push(entry);
    return entry.off;
  },
}));

import { useAttentionStore } from './store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const C1 = '0198f0c0-0000-7000-8000-0000000000c1';
const M1 = '0198f0c0-0000-7000-8000-0000000000a1';

const answer = (workspace_id: string, count: number) => ({ workspace_id, count });
const changed = (
  workspace_id: string,
  change: 'created' | 'edited' | 'state' | 'read',
  item: { type: 'message' | 'reply' | 'activity'; id: string } | null,
): LiveFrame => ({
  v: 1,
  workspace_id,
  type: 'conversation.changed',
  conversation_id: C1,
  item,
  change,
});
const subscriber = (workspaceId = A) =>
  live.subs.find((s) => s.workspaceId === workspaceId)!.subscriber as LiveSubscriber;
const guard = vi.fn();
const count = () => useAttentionStore.getState().count;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  api.getAttentionCount.mockImplementation(async (ws: string) => answer(ws, 3));
});
afterEach(() => {
  useAttentionStore.getState().stop();
  vi.useRealTimers();
});

describe('attention store (AC-01, ADR-0008)', () => {
  it('has no count before the first answer, then holds the answer of the read on enter', async () => {
    let resolve!: (v: unknown) => void;
    api.getAttentionCount.mockReturnValue(new Promise((r) => (resolve = r)));
    useAttentionStore.getState().start(A, guard);
    expect(count()).toBeNull();
    expect(api.getAttentionCount).toHaveBeenCalledWith(A);
    resolve(answer(A, 3));
    await flush();
    expect(count()).toBe(3);
  });

  it('keeps a count of 0 as 0 (known) and a large one uncapped', async () => {
    api.getAttentionCount.mockResolvedValue(answer(A, 137));
    useAttentionStore.getState().start(A, guard);
    await flush();
    expect(count()).toBe(137);
  });

  it.each([
    ['a message', changed(A, 'created', { type: 'message', id: M1 })],
    ['an activity', changed(A, 'created', { type: 'activity', id: M1 })],
    ['a read change', changed(A, 'read', null)],
    ['a state change', changed(A, 'state', null)],
    ['a resync frame', { v: 1, workspace_id: A, type: 'resync' } as LiveFrame],
  ])('refetches once, 300 ms after %s', async (_name, frame) => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    api.getAttentionCount.mockClear();
    api.getAttentionCount.mockResolvedValue(answer(A, 4));
    subscriber().onFrame(frame);
    await vi.advanceTimersByTimeAsync(299);
    expect(api.getAttentionCount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getAttentionCount).toHaveBeenCalledTimes(1);
    expect(count()).toBe(4);
  });

  it('an edit or another frame type does not refetch', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    api.getAttentionCount.mockClear();
    subscriber().onFrame(changed(A, 'edited', { type: 'message', id: M1 }));
    subscriber().onFrame({ v: 1, workspace_id: A, type: 'bot.changed' });
    subscriber().onFrame({ v: 1, workspace_id: A, type: 'telegram_link.changed' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getAttentionCount).not.toHaveBeenCalled();
  });

  it('a burst of 20 frames makes one refetch', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    api.getAttentionCount.mockClear();
    for (let i = 0; i < 20; i++) {
      subscriber().onFrame(changed(A, 'created', { type: 'message', id: M1 }));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(api.getAttentionCount).toHaveBeenCalledTimes(1);
  });

  it('a frame of another workspace is ignored', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    api.getAttentionCount.mockClear();
    subscriber().onFrame(changed(B, 'created', { type: 'message', id: M1 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getAttentionCount).not.toHaveBeenCalled();
  });

  it('refetches after a reconnect and after a dropped frame', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    api.getAttentionCount.mockClear();
    subscriber().onReconnected();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.getAttentionCount).toHaveBeenCalledTimes(1);
    subscriber().onInvalidFrame?.();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.getAttentionCount).toHaveBeenCalledTimes(2);
  });

  it('a failed read keeps the last count and shows nothing; the next frame asks again', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    api.getAttentionCount.mockRejectedValueOnce(new Error('network'));
    subscriber().onFrame(changed(A, 'read', null));
    await vi.advanceTimersByTimeAsync(300);
    expect(count()).toBe(3);
    expect(guard).not.toHaveBeenCalled();
    api.getAttentionCount.mockResolvedValue(answer(A, 1));
    subscriber().onFrame(changed(A, 'read', null));
    await vi.advanceTimersByTimeAsync(300);
    expect(count()).toBe(1);
  });

  it('a failed first read leaves no count', async () => {
    api.getAttentionCount.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    useAttentionStore.getState().start(A, guard);
    await flush();
    expect(count()).toBeNull();
    expect(guard).not.toHaveBeenCalled();
  });

  it('drops a late answer of another workspace after a switch', async () => {
    let late!: (v: unknown) => void;
    api.getAttentionCount.mockImplementationOnce(() => new Promise((r) => (late = r)));
    useAttentionStore.getState().start(A, guard);
    useAttentionStore.getState().stop();
    useAttentionStore.getState().start(B, guard);
    await flush();
    expect(count()).toBe(3);
    late(answer(A, 99));
    await flush();
    expect(count()).toBe(3);
    expect(useAttentionStore.getState().workspaceId).toBe(B);
  });

  it('drops an answer that names another workspace', async () => {
    api.getAttentionCount.mockResolvedValue(answer(B, 9));
    useAttentionStore.getState().start(A, guard);
    await flush();
    expect(count()).toBeNull();
  });

  it('stop clears the count, unsubscribes and cancels a pending refetch', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    const entry = live.subs[0]!;
    subscriber().onFrame(changed(A, 'read', null));
    api.getAttentionCount.mockClear();
    useAttentionStore.getState().stop();
    expect(entry.off).toHaveBeenCalledTimes(1);
    expect(count()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getAttentionCount).not.toHaveBeenCalled();
  });

  it('starting the same workspace again subscribes only once', async () => {
    useAttentionStore.getState().start(A, guard);
    useAttentionStore.getState().start(A, guard);
    await flush();
    expect(live.subs).toHaveLength(1);
  });

  it('the server ending the session (membership.deactivated, 4403) clears the count and re-reads so the guard decides', async () => {
    useAttentionStore.getState().start(A, guard);
    await flush();
    const refusal = new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x');
    api.getAttentionCount.mockRejectedValue(refusal);
    subscriber().onClosed(4403);
    expect(count()).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(guard).toHaveBeenCalledWith(refusal, A);
  });

  it.each([
    [401, ErrorCode.UNAUTHENTICATED],
    [403, ErrorCode.ACCESS_REMOVED],
    [404, ErrorCode.NOT_FOUND],
  ])('a %i answer goes to the shell guard and drops the count', async (status, code) => {
    const refusal = new ApiError(status, code, 'x');
    api.getAttentionCount.mockRejectedValue(refusal);
    useAttentionStore.getState().start(A, guard);
    await flush();
    expect(guard).toHaveBeenCalledWith(refusal, A);
    expect(count()).toBeNull();
  });
});
