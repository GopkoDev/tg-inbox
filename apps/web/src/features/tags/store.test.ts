import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type LiveFrame, type TagWithCount } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { useWorkspaceStore } from '@/features/workspaces/store';

const api = vi.hoisted(() => ({ listTags: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listTags: (...a: unknown[]) => api.listTags(...a),
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

import { useTagsStore } from './store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const tag = (n: number, name: string, count = 0): TagWithCount => ({
  id: `0198f0c0-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`,
  name,
  contact_count: count,
});
const list = (ws: string, items: TagWithCount[]) => ({ workspace_id: ws, items });
const guard = vi.fn();
const frame = (type: string, ws = A) => ({ type, v: 1, workspace_id: ws }) as unknown as LiveFrame;
const emit = (f: LiveFrame) => {
  for (const s of live.subs) (s.subscriber.onFrame as (f: LiveFrame) => void)(f);
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetAllMocks();
  live.subs = [];
  guard.mockResolvedValue('handled');
  useTagsStore.getState().clear();
});

describe('tags store', () => {
  it('reads the workspace tag list once and keeps it', async () => {
    api.listTags.mockResolvedValue(list(A, [tag(1, 'Kyiv', 30), tag(2, 'VIP', 14)]));
    await useTagsStore.getState().load(A, guard);
    expect(useTagsStore.getState()).toMatchObject({ workspaceId: A, status: 'ready' });
    expect(useTagsStore.getState().items.map((t) => t.name)).toEqual(['Kyiv', 'VIP']);
    expect(api.listTags).toHaveBeenCalledTimes(1);
  });

  it('shows an error on the first failed read and keeps the list on a failed background read', async () => {
    api.listTags.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await useTagsStore.getState().load(A, guard);
    expect(useTagsStore.getState().status).toBe('error');
    api.listTags.mockResolvedValueOnce(list(A, [tag(1, 'VIP')]));
    await useTagsStore.getState().load(A, guard);
    api.listTags.mockRejectedValueOnce(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'x'));
    await useTagsStore.getState().load(A, guard, { background: true });
    expect(useTagsStore.getState()).toMatchObject({ status: 'ready' });
    expect(useTagsStore.getState().items).toHaveLength(1);
  });

  it('re-reads on tags.changed, resync and a reconnect, in the background, and nothing else', async () => {
    api.listTags.mockResolvedValue(list(A, [tag(1, 'VIP')]));
    await useTagsStore.getState().load(A, guard);
    const stop = useTagsStore.getState().watch(A, guard);
    api.listTags.mockClear();

    emit(frame('tags.changed'));
    await settle();
    expect(api.listTags).toHaveBeenCalledTimes(1);
    expect(api.listTags).toHaveBeenLastCalledWith(A, { background: true });
    emit(frame('resync'));
    await settle();
    expect(api.listTags).toHaveBeenCalledTimes(2);
    (live.subs[0]!.subscriber.onReconnected as () => void)();
    await settle();
    expect(api.listTags).toHaveBeenCalledTimes(3);

    emit({
      type: 'contact.changed',
      v: 1,
      workspace_id: A,
      contact_id: 'x',
      change: 'tags',
    } as never);
    emit(frame('bot.changed'));
    emit(frame('tags.changed', B));
    await settle();
    expect(api.listTags).toHaveBeenCalledTimes(3);
    stop();
    expect(live.subs).toHaveLength(0);
  });

  it('shows a renamed tag under its new name and drops a merged one after tags.changed', async () => {
    api.listTags.mockResolvedValueOnce(list(A, [tag(1, 'Loyal', 3), tag(2, 'VIP', 12)]));
    await useTagsStore.getState().load(A, guard);
    useTagsStore.getState().watch(A, guard);
    api.listTags.mockResolvedValueOnce(list(A, [tag(2, 'VIP', 14)]));
    emit(frame('tags.changed'));
    await settle();
    expect(useTagsStore.getState().items).toEqual([tag(2, 'VIP', 14)]);
  });

  it('drops the list on a workspace switch and ignores the late answer of the old workspace', async () => {
    let late!: (v: unknown) => void;
    api.listTags.mockImplementationOnce(() => new Promise((r) => (late = r)));
    const first = useTagsStore.getState().load(A, guard);
    api.listTags.mockResolvedValueOnce(list(B, [tag(5, 'Other')]));
    await useTagsStore.getState().load(B, guard);
    late(list(A, [tag(1, 'VIP')]));
    await first;
    expect(useTagsStore.getState()).toMatchObject({ workspaceId: B });
    expect(useTagsStore.getState().items.map((t) => t.name)).toEqual(['Other']);
    useWorkspaceStore.getState().setCurrent({ id: A, name: 'Acme', role: 'operator' });
    useWorkspaceStore.getState().setCurrent({ id: B, name: 'Bolt', role: 'operator' });
    expect(useTagsStore.getState()).toMatchObject({ workspaceId: null, items: [] });
  });

  it('hands a 401 to the guard and shows not found for a 404 NOT_FOUND', async () => {
    api.listTags.mockRejectedValueOnce(new ApiError(401, ErrorCode.UNAUTHENTICATED, 'x'));
    await useTagsStore.getState().load(A, guard);
    expect(guard).toHaveBeenCalledTimes(1);
    guard.mockResolvedValueOnce('not-found');
    api.listTags.mockRejectedValueOnce(new ApiError(404, ErrorCode.NOT_FOUND, 'x'));
    await useTagsStore.getState().load(A, guard);
    expect(useTagsStore.getState().status).toBe('not_found');
  });
});
