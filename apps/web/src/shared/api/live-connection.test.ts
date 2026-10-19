import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from '@tg/shared';
import type { LiveHandlers } from './realtime';

interface Opened {
  workspaceId: string;
  handlers: LiveHandlers;
  close: ReturnType<typeof vi.fn>;
}
const opened: Opened[] = [];
vi.mock('./realtime', () => ({
  openLiveSocket: (workspaceId: string, handlers: LiveHandlers) => {
    const o = { workspaceId, handlers, close: vi.fn() };
    opened.push(o);
    return o;
  },
}));

import { liveStatus, openLiveConnection, subscribeLive } from './live-connection';

const A = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000002';
const resync = (workspace_id: string): LiveFrame => ({ v: 1, workspace_id, type: 'resync' });
const sub = () => ({
  onFrame: vi.fn(),
  onReconnected: vi.fn(),
  onInvalidFrame: vi.fn(),
  onClosed: vi.fn(),
});

beforeEach(() => {
  opened.length = 0;
});

describe('the workspace live connection (SAD §4)', () => {
  it('opens one socket per workspace however many subscribers there are', () => {
    const conn = openLiveConnection(A);
    subscribeLive(A, sub());
    subscribeLive(A, sub());
    expect(opened).toHaveLength(1);
    expect(opened[0]!.workspaceId).toBe(A);
    conn.close();
  });

  it('opening the same workspace twice shares the socket until the last owner closes', () => {
    const one = openLiveConnection(A);
    const two = openLiveConnection(A);
    expect(opened).toHaveLength(1);
    one.close();
    expect(opened[0]!.close).not.toHaveBeenCalled();
    two.close();
    expect(opened[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('fans every frame out to the subscribers of that workspace, in subscription order', () => {
    const conn = openLiveConnection(A);
    const a = sub();
    const b = sub();
    subscribeLive(A, a);
    subscribeLive(A, b);
    opened[0]!.handlers.onFrame(resync(A));
    expect(a.onFrame).toHaveBeenCalledWith(resync(A));
    expect(b.onFrame).toHaveBeenCalledWith(resync(A));
    conn.close();
  });

  it('fans reconnected, invalid-frame and closed out; closed makes the status stopped', () => {
    const conn = openLiveConnection(A);
    const a = sub();
    subscribeLive(A, a);
    expect(liveStatus(A)).toBe('live');
    opened[0]!.handlers.onReconnected();
    opened[0]!.handlers.onInvalidFrame?.();
    opened[0]!.handlers.onClosed(4403);
    expect(a.onReconnected).toHaveBeenCalledTimes(1);
    expect(a.onInvalidFrame).toHaveBeenCalledTimes(1);
    expect(a.onClosed).toHaveBeenCalledWith(4403);
    expect(liveStatus(A)).toBe('stopped');
    conn.close();
  });

  it('an unsubscribed handler hears nothing; a throwing subscriber does not starve the rest', () => {
    const conn = openLiveConnection(A);
    const gone = sub();
    const bad = sub();
    bad.onFrame.mockImplementation(() => {
      throw new Error('boom');
    });
    const good = sub();
    const off = subscribeLive(A, gone);
    subscribeLive(A, bad);
    subscribeLive(A, good);
    off();
    opened[0]!.handlers.onFrame(resync(A));
    expect(gone.onFrame).not.toHaveBeenCalled();
    expect(good.onFrame).toHaveBeenCalledTimes(1);
    conn.close();
  });

  it('subscribing before the frame opens the socket still receives frames (child effects run first)', () => {
    const early = sub();
    subscribeLive(A, early);
    expect(liveStatus(A)).toBe('idle');
    const conn = openLiveConnection(A);
    opened[0]!.handlers.onFrame(resync(A));
    expect(early.onFrame).toHaveBeenCalledTimes(1);
    conn.close();
  });

  it('survives navigation: subscribers come and go while the socket stays open', () => {
    const conn = openLiveConnection(A);
    const off = subscribeLive(A, sub());
    off();
    subscribeLive(A, sub());
    expect(opened).toHaveLength(1);
    expect(opened[0]!.close).not.toHaveBeenCalled();
    conn.close();
  });

  it('a workspace switch: closing the old connection and opening the new one keeps the workspaces apart', () => {
    const old = openLiveConnection(A);
    const inA = sub();
    const off = subscribeLive(A, inA);
    old.close();
    off();
    expect(opened[0]!.close).toHaveBeenCalledTimes(1);
    const fresh = openLiveConnection(B);
    const inB = sub();
    subscribeLive(B, inB);
    expect(opened).toHaveLength(2);
    opened[1]!.handlers.onFrame(resync(B));
    expect(inB.onFrame).toHaveBeenCalledTimes(1);
    opened[0]!.handlers.onFrame(resync(A));
    expect(inA.onFrame).not.toHaveBeenCalled();
    expect(liveStatus(A)).toBe('idle');
    fresh.close();
  });

  it('closing a connection mutes its late frames and resets its status', () => {
    const conn = openLiveConnection(A);
    const a = sub();
    subscribeLive(A, a);
    conn.close();
    opened[0]!.handlers.onFrame(resync(A));
    expect(a.onFrame).not.toHaveBeenCalled();
    expect(liveStatus(A)).toBe('idle');
  });
});
