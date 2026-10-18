import { describe, expect, it, vi } from 'vitest';
import { LiveFrame } from '@tg/shared';
import { newId } from '../../../platform/ids.js';
import type { RealtimeSignal } from '../../../platform/realtime.js';
import { createLiveHub, type LiveSocket } from './hub.js';

class FakeSocket implements LiveSocket {
  frames: unknown[] = [];
  closed: { code: number; reason: string } | null = null;
  pings = 0;
  send(data: string) {
    this.frames.push(JSON.parse(data));
  }
  ping() {
    this.pings += 1;
  }
  close(code: number, reason: string) {
    this.closed ??= { code, reason };
  }
}

const logger = { warn: vi.fn(), error: vi.fn() };

function setup(
  state: { sessions?: Set<string>; members?: Map<string, Set<string>> } = {},
  opts: { pingMs?: number; revalidateMs?: number } = {},
) {
  const sessions = state.sessions ?? new Set<string>();
  const members = state.members ?? new Map<string, Set<string>>();
  const queries = { sessions: 0, members: [] as string[] };
  const hub = createLiveHub({
    sessions: {
      async liveSessionIds(ids) {
        queries.sessions += 1;
        return ids.filter((i) => sessions.has(i));
      },
    },
    members: {
      async activeMembersAmong(ws, accountIds) {
        queries.members.push(ws);
        return accountIds.filter((a) => members.get(ws)?.has(a));
      },
    },
    logger,
    ...opts,
  });
  const open = (ws: string, account: string, session = newId()) => {
    const socket = new FakeSocket();
    sessions.add(session);
    if (!members.has(ws)) members.set(ws, new Set());
    members.get(ws)!.add(account);
    hub.attach(socket, { workspaceId: ws, accountId: account, sessionId: session });
    return { socket, session };
  };
  return { hub, open, sessions, members, queries };
}

const changed = (
  ws: string,
  extra: Partial<Extract<RealtimeSignal, { type: 'conversation.changed' }>> = {},
): RealtimeSignal => ({
  type: 'conversation.changed',
  v: 1,
  workspace_id: ws,
  conversation_id: newId(),
  item: { type: 'message', id: newId() },
  change: 'created',
  ...extra,
});

describe('live hub dispatch', () => {
  it('sends a conversation frame only to the sockets of its workspace, and it parses as LiveFrame', () => {
    const { hub, open } = setup();
    const [a, b] = [newId(), newId()];
    const inA = open(a, newId());
    const inB = open(b, newId());
    const signal = changed(a);
    hub.dispatch(signal);
    expect(inB.socket.frames).toEqual([]);
    expect(inA.socket.frames).toHaveLength(1);
    expect(LiveFrame.parse(inA.socket.frames[0])).toMatchObject({
      type: 'conversation.changed',
      workspace_id: a,
    });
  });

  it('frames carry ids only: no account id leaks from a read signal', () => {
    const { hub, open } = setup();
    const ws = newId();
    const me = newId();
    const mine = open(ws, me);
    hub.dispatch(changed(ws, { item: null, change: 'read', account_id: me }));
    expect(Object.keys(mine.socket.frames[0] as object).sort()).toEqual(
      ['change', 'conversation_id', 'item', 'type', 'v', 'workspace_id'].sort(),
    );
  });

  it('sends a read change only to the sockets of the reading account, in every tab', () => {
    const { hub, open } = setup();
    const ws = newId();
    const [me, other] = [newId(), newId()];
    const tab1 = open(ws, me);
    const tab2 = open(ws, me);
    const teammate = open(ws, other);
    hub.dispatch(changed(ws, { item: null, change: 'read', account_id: me }));
    expect(tab1.socket.frames).toHaveLength(1);
    expect(tab2.socket.frames).toHaveLength(1);
    expect(teammate.socket.frames).toEqual([]);
  });

  it('forwards bot.changed to every socket of the workspace only', () => {
    const { hub, open } = setup();
    const [a, b] = [newId(), newId()];
    const x = open(a, newId());
    const y = open(a, newId());
    const z = open(b, newId());
    hub.dispatch({ type: 'bot.changed', v: 1, workspace_id: a });
    expect(x.socket.frames).toHaveLength(1);
    expect(y.socket.frames).toHaveLength(1);
    expect(z.socket.frames).toEqual([]);
    expect(LiveFrame.parse(x.socket.frames[0])).toEqual({
      type: 'bot.changed',
      v: 1,
      workspace_id: a,
    });
  });

  it('membership.deactivated closes only that account sockets of that workspace with 4403 and forwards nothing', () => {
    const { hub, open } = setup();
    const [a, b] = [newId(), newId()];
    const account = newId();
    const inA = open(a, account);
    const inB = open(b, account);
    const colleague = open(a, newId());
    hub.dispatch({ type: 'membership.deactivated', v: 1, workspace_id: a, account_id: account });
    expect(inA.socket.closed?.code).toBe(4403);
    expect(inB.socket.closed).toBeNull();
    expect(colleague.socket.closed).toBeNull();
    expect(colleague.socket.frames).toEqual([]);
  });

  it('resync goes to every socket with its own workspace id', () => {
    const { hub, open } = setup();
    const [a, b] = [newId(), newId()];
    const x = open(a, newId());
    const y = open(b, newId());
    hub.resync();
    expect(x.socket.frames).toEqual([{ type: 'resync', v: 1, workspace_id: a }]);
    expect(y.socket.frames).toEqual([{ type: 'resync', v: 1, workspace_id: b }]);
  });

  it('a socket that was detached receives nothing', () => {
    const { hub, open } = setup();
    const ws = newId();
    const x = open(ws, newId());
    hub.detach(x.socket);
    hub.dispatch({ type: 'bot.changed', v: 1, workspace_id: ws });
    expect(x.socket.frames).toEqual([]);
  });

  it('stop closes every socket with 1001', async () => {
    const { hub, open } = setup();
    const x = open(newId(), newId());
    await hub.stop();
    expect(x.socket.closed?.code).toBe(1001);
  });
});

describe('live hub re-validation', () => {
  it('closes a socket whose membership is no longer active with 4403, in one members query per workspace', async () => {
    const { hub, open, members, queries } = setup();
    const [a, b] = [newId(), newId()];
    const gone = newId();
    const g = open(a, gone);
    const stays = open(a, newId());
    const other = open(b, newId());
    members.get(a)!.delete(gone);
    await hub.revalidate();
    expect(g.socket.closed?.code).toBe(4403);
    expect(stays.socket.closed).toBeNull();
    expect(other.socket.closed).toBeNull();
    expect(queries.members.sort()).toEqual([a, b].sort());
  });

  it('closes a socket whose session ended with 4401', async () => {
    const { hub, open, sessions } = setup();
    const x = open(newId(), newId());
    const y = open(newId(), newId());
    sessions.delete(x.session);
    await hub.revalidate();
    expect(x.socket.closed?.code).toBe(4401);
    expect(y.socket.closed).toBeNull();
  });

  it('makes no queries when there are no sockets', async () => {
    const { hub, queries } = setup();
    await hub.revalidate();
    expect(queries).toEqual({ sessions: 0, members: [] });
  });

  it('keeps sockets open when the check itself fails, and retries', async () => {
    const hub = createLiveHub({
      sessions: {
        liveSessionIds: () => Promise.reject(new Error('db down')),
      },
      members: { activeMembersAmong: () => Promise.resolve([]) },
      logger,
    });
    const socket = new FakeSocket();
    hub.attach(socket, { workspaceId: newId(), accountId: newId(), sessionId: newId() });
    await hub.revalidate();
    expect(socket.closed).toBeNull();
  });

  it('runs on its timer and pings on its timer', async () => {
    vi.useFakeTimers();
    try {
      const { hub, open, members } = setup({}, { pingMs: 25_000, revalidateMs: 5_000 });
      const ws = newId();
      const account = newId();
      const x = open(ws, account);
      hub.start();
      await vi.advanceTimersByTimeAsync(24_000);
      expect(x.socket.pings).toBe(0);
      members.get(ws)!.delete(account);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(x.socket.closed?.code).toBe(4403);
      const y = open(ws, newId());
      await vi.advanceTimersByTimeAsync(2_000);
      expect(y.socket.pings).toBe(0);
      expect(x.socket.pings).toBe(1);
      await hub.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
