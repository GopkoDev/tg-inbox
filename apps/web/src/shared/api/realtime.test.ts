import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLiveSocket, type SocketLike } from './realtime';

const W1 = '0198f0c0-0000-7000-8000-000000000001';
const C1 = '0198f0c0-0000-7000-8000-0000000000c1';
const M1 = '0198f0c0-0000-7000-8000-0000000000a1';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  open() {
    this.onopen?.();
  }
  sent: string[] = [];
  send = (data: string) => {
    this.sent.push(data);
  };
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  drop(code: number) {
    this.onclose?.({ code });
  }
}

const changed = {
  v: 1,
  workspace_id: W1,
  type: 'conversation.changed',
  conversation_id: C1,
  item: { type: 'message', id: M1 },
  change: 'created',
};

function start() {
  const handlers = { onFrame: vi.fn(), onReconnected: vi.fn(), onClosed: vi.fn() };
  const client = openLiveSocket(W1, handlers, {
    createSocket: (url) => new FakeSocket(url),
    backoffMs: (attempt) => 100 * 2 ** attempt,
  });
  return { handlers, client };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('openLiveSocket', () => {
  it('resumed after a stop: the first open reports reconnected, signals may have been missed (W9)', () => {
    const handlers = { onFrame: vi.fn(), onReconnected: vi.fn(), onClosed: vi.fn() };
    openLiveSocket(W1, handlers, { createSocket: (url) => new FakeSocket(url), resumed: true });
    FakeSocket.all[0]!.open();
    expect(handlers.onReconnected).toHaveBeenCalledTimes(1);
    FakeSocket.all[0]!.drop(1001);
    vi.runOnlyPendingTimers();
    FakeSocket.all[1]!.open();
    expect(handlers.onReconnected).toHaveBeenCalledTimes(2);
  });

  it('a first attempt that never opened: the first successful open reports reconnected (W8)', () => {
    const { handlers } = start();
    FakeSocket.all[0]!.drop(1006);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    expect(handlers.onReconnected).toHaveBeenCalledTimes(1);
  });

  it('opens one socket for the workspace at /api/workspaces/:ws/inbox/live', () => {
    start();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0]!.url).toMatch(
      /^wss?:\/\/.+\/api\/workspaces\/0198f0c0-.*\/inbox\/live$/,
    );
  });

  it('delivers parsed frames and ignores unknown types and malformed data', () => {
    const { handlers } = start();
    const s = FakeSocket.all[0]!;
    s.open();
    s.receive(changed);
    s.receive({ v: 1, workspace_id: W1, type: 'something.new' });
    s.receive('not json');
    s.receive({ ...changed, change: 'bogus' });
    expect(handlers.onFrame).toHaveBeenCalledTimes(1);
    expect(handlers.onFrame).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conversation.changed' }),
    );
  });

  it('reports a dropped frame (malformed, unknown type, bad schema) to onInvalidFrame and keeps the socket', () => {
    const onInvalidFrame = vi.fn();
    const handlers = {
      onFrame: vi.fn(),
      onReconnected: vi.fn(),
      onClosed: vi.fn(),
      onInvalidFrame,
    };
    openLiveSocket(W1, handlers, { createSocket: (url) => new FakeSocket(url) });
    const s = FakeSocket.all[0]!;
    s.open();
    s.receive(changed);
    expect(onInvalidFrame).not.toHaveBeenCalled();
    s.receive('not json');
    s.receive({ v: 1, workspace_id: W1, type: 'something.new' });
    s.receive({ ...changed, change: 'bogus' });
    expect(onInvalidFrame).toHaveBeenCalledTimes(3);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('reconnects with growing backoff after 1001 or a drop, and reports reconnected on open', () => {
    const { handlers } = start();
    FakeSocket.all[0]!.open();
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    FakeSocket.all[0]!.drop(1001);
    vi.advanceTimersByTime(99);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    // failed attempt: no open, dropped again (1006) -> next delay is longer
    FakeSocket.all[1]!.drop(1006);
    vi.advanceTimersByTime(199);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.open();
    expect(handlers.onReconnected).toHaveBeenCalledTimes(1);
    // a successful open resets the backoff
    FakeSocket.all[2]!.drop(1001);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it.each([4401, 4403])('close %i: no reconnect, onClosed carries the code', (code) => {
    const { handlers } = start();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.drop(code);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(handlers.onClosed).toHaveBeenCalledWith(code);
  });

  it('close(): closes the socket, stops reconnecting and mutes frames', () => {
    const { handlers, client } = start();
    const s = FakeSocket.all[0]!;
    s.open();
    client.close();
    expect(s.close).toHaveBeenCalled();
    s.receive(changed);
    s.drop(1001);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(handlers.onFrame).not.toHaveBeenCalled();
  });

  it('close() during a pending reconnect cancels it', () => {
    const { client } = start();
    FakeSocket.all[0]!.drop(1001);
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  describe('presence frames (AC-07)', () => {
    const setVisibility = (state: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const presence = (s: FakeSocket) => s.sent.map((m) => JSON.parse(m));
    afterEach(() => setVisibility('visible'));

    it('sends on_screen true once right after the socket opens while the tab is visible', () => {
      start();
      const s = FakeSocket.all[0]!;
      expect(s.sent).toEqual([]);
      s.open();
      expect(presence(s)).toEqual([{ type: 'presence', v: 1, on_screen: true }]);
    });

    it('a tab hidden at open sends on_screen false first', () => {
      setVisibility('hidden');
      start();
      FakeSocket.all[0]!.open();
      expect(presence(FakeSocket.all[0]!)).toEqual([{ type: 'presence', v: 1, on_screen: false }]);
    });

    it('sends on every visibilitychange while open', () => {
      start();
      const s = FakeSocket.all[0]!;
      s.open();
      setVisibility('hidden');
      setVisibility('visible');
      expect(presence(s).map((f) => f.on_screen)).toEqual([true, false, true]);
    });

    it('sends nothing while the socket is not open and again after a reconnect opens', () => {
      start();
      const s = FakeSocket.all[0]!;
      setVisibility('hidden');
      expect(s.sent).toEqual([]);
      s.open();
      s.drop(1006);
      setVisibility('visible');
      expect(s.sent).toHaveLength(1);
      vi.advanceTimersByTime(100);
      FakeSocket.all[1]!.open();
      expect(presence(FakeSocket.all[1]!)).toEqual([{ type: 'presence', v: 1, on_screen: true }]);
    });

    it('close() removes the visibilitychange listener', () => {
      const { client } = start();
      const s = FakeSocket.all[0]!;
      s.open();
      client.close();
      setVisibility('hidden');
      expect(s.sent).toHaveLength(1);
    });

    it('a session-ended close removes the listener too', () => {
      start();
      const s = FakeSocket.all[0]!;
      s.open();
      s.drop(4401);
      setVisibility('hidden');
      expect(s.sent).toHaveLength(1);
    });
  });
});
