import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type BroadcastRecipientPage,
  type LaunchedBroadcast,
  type LiveFrame,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';

const api = vi.hoisted(() => ({ getBroadcast: vi.fn(), listBroadcastRecipients: vi.fn() }));
vi.mock('./api', () => ({
  getBroadcast: (...a: unknown[]) => api.getBroadcast(...a),
  listBroadcastRecipients: (...a: unknown[]) => api.listBroadcastRecipients(...a),
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

import { useBroadcastReportStore } from './report-store';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const BC = '0198f0c0-0000-7000-8000-000000000301';
const OTHER = '0198f0c0-0000-7000-8000-000000000302';
const member = { account_id: '0198f0c0-0000-7000-8000-000000000501', display_name: 'Test User' };
const guard = vi.fn();
const settle = () => new Promise((r) => setTimeout(r, 0));
const contact = (n: number) => ({
  id: `0198f0c0-0000-7000-8000-${String(900 + n).padStart(12, '0')}`,
  first_name: 'Test User',
  last_name: null,
  username: null,
});

const broadcast = (delivered = 0): LaunchedBroadcast => ({
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
    audience_size: 2,
    blocked_count: 0,
    never_wrote_count: 0,
    recipient_count: 2,
  },
  stopped_by: null,
  stopped_at: null,
  ended_at: null,
  end_reason: null,
  totals: {
    waiting: 2 - delivered,
    sending: 0,
    delivered,
    blocked: 0,
    failed: 0,
    not_confirmed: 0,
    stopped: 0,
  },
  not_reached_count: 0,
});
const page = (o: Partial<BroadcastRecipientPage> = {}): BroadcastRecipientPage => ({
  workspace_id: A,
  broadcast_id: BC,
  state: null,
  items: [
    {
      id: '0198f0c0-0000-7000-8000-000000000701',
      position: 1,
      contact: contact(1),
      state: 'waiting',
      failure_reason: null,
      outcome_at: null,
    },
  ],
  has_prev: false,
  has_next: false,
  next_cursor: null,
  ...o,
});
const row = (n: number) => ({
  id: `0198f0c0-0000-7000-8000-${String(700 + n).padStart(12, '0')}`,
  position: n,
  contact: contact(n),
  state: 'waiting' as const,
  failure_reason: null,
  outcome_at: null,
});
const frame = (o: Partial<Extract<LiveFrame, { type: 'broadcast.changed' }>> = {}): LiveFrame => ({
  type: 'broadcast.changed',
  v: 1,
  workspace_id: A,
  broadcast_id: BC,
  change: 'report',
  ...o,
});
const emit = (f: LiveFrame) => live.subs.forEach((s) => s.subscriber.onFrame!(f as never));
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function opened() {
  api.getBroadcast.mockResolvedValue(broadcast());
  api.listBroadcastRecipients.mockResolvedValue(page());
  await useBroadcastReportStore.getState().open(A, BC, guard);
  const stop = useBroadcastReportStore.getState().watch(A, guard);
  api.getBroadcast.mockClear();
  api.listBroadcastRecipients.mockClear();
  return stop;
}

beforeEach(() => {
  vi.clearAllMocks();
  live.subs = [];
  useBroadcastReportStore.getState().close();
});

describe('broadcast report store (SCR-28)', () => {
  it('opens with the totals and the first page of 50 recipients', async () => {
    await opened();
    expect(useBroadcastReportStore.getState()).toMatchObject({
      workspaceId: A,
      broadcastId: BC,
      status: 'ready',
      broadcast: broadcast(),
      filter: null,
      recipients: { items: page().items, hasNext: false },
    });
  });

  it('re-reads on report and status, one fetch at a time: a frame during a fetch leads to exactly one more', async () => {
    await opened();
    const first = deferred<LaunchedBroadcast>();
    api.getBroadcast.mockReturnValueOnce(first.promise).mockResolvedValue(broadcast(2));
    api.listBroadcastRecipients.mockResolvedValue(page());
    emit(frame({ change: 'report' }));
    emit(frame({ change: 'status' }));
    emit(frame({ change: 'report' }));
    await settle();
    expect(api.getBroadcast).toHaveBeenCalledTimes(1);
    first.resolve(broadcast(1));
    await settle();
    await settle();
    await settle();
    expect(api.getBroadcast).toHaveBeenCalledTimes(2);
    expect(api.getBroadcast).toHaveBeenLastCalledWith(A, BC, { background: true });
    expect(api.listBroadcastRecipients).toHaveBeenCalledTimes(2);
    expect(useBroadcastReportStore.getState().broadcast).toEqual(broadcast(2));
  });

  it('ignores draft, group and deleted frames, other broadcasts and other workspaces', async () => {
    await opened();
    emit(frame({ change: 'draft' }));
    emit(frame({ change: 'group' }));
    emit(frame({ broadcast_id: OTHER }));
    emit(frame({ workspace_id: B }));
    await settle();
    expect(api.getBroadcast).not.toHaveBeenCalled();
    expect(api.listBroadcastRecipients).not.toHaveBeenCalled();
  });

  it('filters by outcome and shows more with the next cursor', async () => {
    await opened();
    api.listBroadcastRecipients.mockResolvedValue(
      page({ state: 'failed', has_next: true, next_cursor: 'c1' }),
    );
    await useBroadcastReportStore.getState().setFilter('failed', guard);
    expect(api.listBroadcastRecipients).toHaveBeenLastCalledWith(A, BC, { state: 'failed' }, {});
    api.listBroadcastRecipients.mockResolvedValue(page({ state: 'failed', items: [row(2)] }));
    await useBroadcastReportStore.getState().showMore(guard);
    expect(api.listBroadcastRecipients).toHaveBeenLastCalledWith(
      A,
      BC,
      { state: 'failed', after: 'c1' },
      {},
    );
    expect(useBroadcastReportStore.getState().recipients.items).toHaveLength(2);
  });

  it('keeps what is shown when a background re-read fails', async () => {
    await opened();
    api.getBroadcast.mockRejectedValue(new ApiError(500, ErrorCode.INTERNAL_ERROR, 'boom'));
    emit(frame());
    await settle();
    await settle();
    expect(useBroadcastReportStore.getState()).toMatchObject({
      status: 'ready',
      broadcast: broadcast(),
    });
    expect(guard).not.toHaveBeenCalled();
  });

  it('W2: a re-read while Show more is in flight waits for it; no recipient is shown twice', async () => {
    api.getBroadcast.mockResolvedValue(broadcast());
    api.listBroadcastRecipients.mockResolvedValue(
      page({ items: [row(1)], has_next: true, next_cursor: 'c1' }),
    );
    await useBroadcastReportStore.getState().open(A, BC, guard);
    useBroadcastReportStore.getState().watch(A, guard);
    const more = deferred<BroadcastRecipientPage>();
    api.listBroadcastRecipients.mockReturnValueOnce(more.promise);
    const shown = useBroadcastReportStore.getState().showMore(guard);
    await settle();
    // The re-read's first page now holds both recipients.
    api.listBroadcastRecipients.mockResolvedValue(page({ items: [row(1), row(2)] }));
    emit(frame());
    await settle();
    await settle();
    more.resolve(page({ items: [row(2)] }));
    await shown;
    await settle();
    await settle();
    await settle();
    const ids = useBroadcastReportStore.getState().recipients.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([row(1).id, row(2).id]);
    expect(useBroadcastReportStore.getState().recipients.more).toBe('idle');
  });

  it('RR-W1: a Show more started while a re-read is in flight wins; the re-read runs again after it', async () => {
    api.getBroadcast.mockResolvedValue(broadcast());
    api.listBroadcastRecipients.mockResolvedValue(
      page({ items: [row(1)], has_next: true, next_cursor: 'c1' }),
    );
    await useBroadcastReportStore.getState().open(A, BC, guard);
    useBroadcastReportStore.getState().watch(A, guard);
    api.getBroadcast.mockClear();
    api.listBroadcastRecipients.mockClear();
    const reread = deferred<LaunchedBroadcast>();
    const again = deferred<LaunchedBroadcast>();
    api.getBroadcast.mockReturnValueOnce(reread.promise).mockReturnValueOnce(again.promise);
    emit(frame());
    await settle();
    const more = deferred<BroadcastRecipientPage>();
    api.listBroadcastRecipients
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(page({ items: [row(1)], has_next: true, next_cursor: 'c1' }))
      .mockResolvedValue(page({ items: [row(1), row(2)] }));
    const shown = useBroadcastReportStore.getState().showMore(guard);
    // The re-read lands first.
    reread.resolve(broadcast(1));
    await settle();
    await settle();
    more.resolve(page({ items: [row(2)] }));
    await shown;
    await settle();
    expect(useBroadcastReportStore.getState().recipients.items.map((r) => r.id)).toEqual([
      row(1).id,
      row(2).id,
    ]);
    expect(api.getBroadcast).toHaveBeenCalledTimes(2);
    again.resolve(broadcast(2));
    await settle();
    await settle();
    expect(useBroadcastReportStore.getState().broadcast).toEqual(broadcast(2));
    expect(useBroadcastReportStore.getState().recipients.items.map((r) => r.id)).toEqual([
      row(1).id,
      row(2).id,
    ]);
  });

  it('U3: a failed filter read keeps the page and fails in the report; Retry reads the same filter', async () => {
    await opened();
    api.listBroadcastRecipients.mockRejectedValueOnce(new Error('network'));
    await useBroadcastReportStore.getState().setFilter('failed', guard);
    expect(useBroadcastReportStore.getState()).toMatchObject({
      status: 'ready',
      filter: 'failed',
      recipients: { status: 'error' },
    });
    api.listBroadcastRecipients.mockResolvedValue(page({ state: 'failed' }));
    await useBroadcastReportStore.getState().retryRecipients(guard);
    expect(api.listBroadcastRecipients).toHaveBeenLastCalledWith(A, BC, { state: 'failed' }, {});
    expect(useBroadcastReportStore.getState()).toMatchObject({
      filter: 'failed',
      recipients: { status: 'ready' },
    });
  });
});
