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
  send(data: unknown) {
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
    s.send(changed);
    s.send({ v: 1, workspace_id: W1, type: 'something.new' });
    s.send('not json');
    s.send({ ...changed, change: 'bogus' });
    expect(handlers.onFrame).toHaveBeenCalledTimes(1);
    expect(handlers.onFrame).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conversation.changed' }),
    );
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
    s.send(changed);
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
});
