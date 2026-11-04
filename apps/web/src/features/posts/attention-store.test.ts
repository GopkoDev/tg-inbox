import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import type { LiveSubscriber } from '@/shared/api/live-connection';

const api = vi.hoisted(() => ({ getPostAttention: vi.fn() }));
vi.mock('./api', () => ({
  getPostAttention: (...a: unknown[]) => api.getPostAttention(...a),
}));
const live = vi.hoisted(() => ({
  subs: [] as { workspaceId: string; subscriber: unknown; off: () => void }[],
}));
vi.mock('@/shared/api/live-connection', () => ({
  reviveLiveConnection: vi.fn(),
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

import { usePostAttentionStore } from './attention-store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const P1 = '0198f0c0-0000-7000-8000-0000000000b1';

const postChanged = (workspace_id: string): LiveFrame => ({
  v: 1,
  workspace_id,
  type: 'post.changed',
  post_id: P1,
});
const subscriber = (ws = A) =>
  live.subs.find((s) => s.workspaceId === ws)!.subscriber as LiveSubscriber;
const guard = vi.fn();
const count = () => usePostAttentionStore.getState().count;
const flush = () => vi.advanceTimersByTimeAsync(400);

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  api.getPostAttention.mockResolvedValue({ count: 2 });
});
afterEach(() => {
  usePostAttentionStore.getState().stop();
  vi.useRealTimers();
});

describe('posts attention store (AC-12, AC-13)', () => {
  it('has no count while loading, then holds the count of posts needing attention', async () => {
    usePostAttentionStore.getState().start(A, guard);
    expect(count()).toBeNull();
    await flush();
    expect(api.getPostAttention).toHaveBeenCalledWith(A);
    expect(count()).toBe(2);
  });

  it('re-reads on post.changed', async () => {
    usePostAttentionStore.getState().start(A, guard);
    await flush();
    api.getPostAttention.mockResolvedValue({ count: 3 });
    subscriber().onFrame!(postChanged(A));
    await flush();
    expect(count()).toBe(3);
  });

  it('ignores a live frame for another workspace', async () => {
    usePostAttentionStore.getState().start(A, guard);
    await flush();
    api.getPostAttention.mockClear();
    subscriber().onFrame!(postChanged(B));
    await flush();
    expect(api.getPostAttention).not.toHaveBeenCalled();
    expect(count()).toBe(2);
  });

  it('keeps the last count when a read fails', async () => {
    usePostAttentionStore.getState().start(A, guard);
    await flush();
    api.getPostAttention.mockRejectedValue(new ApiError(500, 'INTERNAL' as never, 'x'));
    subscriber().onFrame!(postChanged(A));
    await flush();
    expect(count()).toBe(2);
  });
});
