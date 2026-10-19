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

/** Records what the hub reports to notifications, in order. */
function fakePresence() {
  const calls: string[] = [];
  const log = (name: string, ...args: unknown[]) => {
    calls.push([name, ...args].join('|'));
    return Promise.resolve();
  };
  return {
    calls,
    opened: (ws: string, account: string, conn: string, onScreen: boolean) =>
      log('opened', ws, account, conn, onScreen),
    alive: (ws: string, conn: string) => log('alive', ws, conn),
    screen: (ws: string, conn: string, account: string, onScreen: boolean, hiddenForMs?: number) =>
      log(
        'screen',
        ws,
        conn,
        account,
        onScreen,
        ...(hiddenForMs !== undefined ? [hiddenForMs] : []),
      ),
    closed: (ws: string, conn: string) => log('closed', ws, conn),
  };
}

function setup(
  state: { sessions?: Set<string>; members?: Map<string, Set<string>> } = {},
  opts: { pingMs?: number; revalidateMs?: number; presenceCoalesceMs?: number } = {},
) {
  const presence = fakePresence();
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
    presence,
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
  return { hub, open, sessions, members, queries, presence };
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

  it('forwards contact.changed and tags.changed to every socket of the workspace only, ids only', () => {
    const { hub, open } = setup();
    const [a, b] = [newId(), newId()];
    const x = open(a, newId());
    const y = open(a, newId());
    const z = open(b, newId());
    const contactId = newId();
    hub.dispatch({
      type: 'contact.changed',
      v: 1,
      workspace_id: a,
      contact_id: contactId,
      change: 'tags',
    });
    hub.dispatch({ type: 'tags.changed', v: 1, workspace_id: a });
    for (const s of [x, y]) {
      expect(s.socket.frames.map((f) => LiveFrame.parse(f))).toEqual([
        { type: 'contact.changed', v: 1, workspace_id: a, contact_id: contactId, change: 'tags' },
        { type: 'tags.changed', v: 1, workspace_id: a },
      ]);
    }
    expect(z.socket.frames).toEqual([]);
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
      presence: fakePresence(),
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

describe('live hub telegram_link.changed (ADR-0010, AC-04)', () => {
  it('reaches only the sockets of that account in that workspace, and carries no account id', () => {
    const { hub, open } = setup();
    const [a, b] = [newId(), newId()];
    const [me, teammate] = [newId(), newId()];
    const tab1 = open(a, me);
    const tab2 = open(a, me);
    const mate = open(a, teammate);
    const otherWorkspace = open(b, me);
    hub.dispatch({ type: 'telegram_link.changed', v: 1, workspace_id: a, account_id: me });
    for (const tab of [tab1, tab2]) {
      expect(LiveFrame.parse(tab.socket.frames[0])).toEqual({
        type: 'telegram_link.changed',
        v: 1,
        workspace_id: a,
      });
    }
    expect(mate.socket.frames).toEqual([]);
    expect(otherWorkspace.socket.frames).toEqual([]);
  });
});

describe('live hub presence (ADR-0002, AC-07)', () => {
  const frame = (onScreen: unknown) =>
    JSON.stringify({ type: 'presence', v: 1, on_screen: onScreen });
  const connOf = (presence: ReturnType<typeof fakePresence>, i = 0) =>
    presence.calls.filter((c) => c.startsWith('opened'))[i]!.split('|')[3]!;

  it('registers a lease for each socket on open, hidden until its first frame, with its own connection id', async () => {
    const { open, presence } = setup();
    const [ws, me] = [newId(), newId()];
    open(ws, me);
    open(ws, me);
    await new Promise((r) => setTimeout(r, 0));
    const opened = presence.calls.map((c) => c.split('|'));
    expect(opened).toHaveLength(2);
    expect(opened[0]!.slice(0, 3)).toEqual(['opened', ws, me]);
    expect(opened[0]![4]).toBe('false');
    expect(opened[0]![3]).not.toBe(opened[1]![3]);
    expect(opened[0]![3]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('a pong extends the lease of that socket only', async () => {
    const { hub, open, presence } = setup();
    const ws = newId();
    const x = open(ws, newId());
    open(ws, newId());
    hub.pong(x.socket);
    await new Promise((r) => setTimeout(r, 0));
    expect(presence.calls.filter((c) => c.startsWith('alive'))).toEqual([
      `alive|${ws}|${connOf(presence, 0)}`,
    ]);
  });

  it('detach and an access close each delete the lease once; a server stop (1001) leaves it to expire', async () => {
    const { hub, open, presence, members } = setup();
    const ws = newId();
    const [a1, a2, a3] = [newId(), newId(), newId()];
    const x = open(ws, a1);
    open(ws, a2);
    const z = open(ws, a3);
    hub.detach(x.socket);
    hub.detach(x.socket);
    members.get(ws)!.delete(a2);
    await hub.revalidate();
    await hub.stop();
    await new Promise((r) => setTimeout(r, 0));
    expect(z.socket.closed?.code).toBe(1001);
    const closed = presence.calls.filter((c) => c.startsWith('closed'));
    // A deploy must not make an on-screen member look away: the tab reconnects to another instance
    // while the old lease still counts until it passes (at most 50 s).
    expect(closed.map((c) => c.split('|')[2]).sort()).toEqual(
      [0, 1].map((i) => connOf(presence, i)).sort(),
    );
  });

  it('a stop still writes a pending screen state before the database is released', async () => {
    vi.useFakeTimers();
    try {
      const { hub, open, presence } = setup({}, { presenceCoalesceMs: 1000 });
      const [ws, me] = [newId(), newId()];
      const x = open(ws, me);
      hub.message(x.socket, Buffer.from(frame(true)));
      hub.message(x.socket, Buffer.from(frame(false)));
      await hub.stop();
      expect(presence.calls.filter((c) => c.startsWith('screen'))).toEqual([
        `screen|${ws}|${connOf(presence)}|${me}|true`,
        `screen|${ws}|${connOf(presence)}|${me}|false`,
      ]);
      expect(presence.calls.filter((c) => c.startsWith('closed'))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a membership.deactivated close deletes the lease', async () => {
    const { hub, open, presence } = setup();
    const [ws, me] = [newId(), newId()];
    open(ws, me);
    hub.dispatch({ type: 'membership.deactivated', v: 1, workspace_id: ws, account_id: me });
    await new Promise((r) => setTimeout(r, 0));
    expect(presence.calls.filter((c) => c.startsWith('closed'))).toHaveLength(1);
  });

  it("writes a socket's first frame at once, then coalesces a burst into one write with the last value", async () => {
    vi.useFakeTimers();
    try {
      const { hub, open, presence } = setup({}, { presenceCoalesceMs: 1000 });
      const [ws, me] = [newId(), newId()];
      const x = open(ws, me);
      const screens = () => presence.calls.filter((c) => c.startsWith('screen'));
      // Leading edge: the opening frame of a reconnected tab is not held back by the window.
      hub.message(x.socket, Buffer.from(frame(true)));
      await vi.advanceTimersByTimeAsync(0);
      expect(screens()).toEqual([`screen|${ws}|${connOf(presence)}|${me}|true`]);
      for (const v of [false, true, false, true, false, true, false, true, false]) {
        hub.message(x.socket, Buffer.from(frame(v)));
      }
      await vi.advanceTimersByTimeAsync(999);
      expect(screens()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(screens()).toEqual([
        `screen|${ws}|${connOf(presence)}|${me}|true`,
        `screen|${ws}|${connOf(presence)}|${me}|false`,
      ]);
      // Within the next window: held back again, at most one write per window.
      hub.message(x.socket, Buffer.from(frame(true)));
      await vi.advanceTimersByTimeAsync(0);
      expect(screens()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(screens()).toHaveLength(3);
      // A quiet window later, the next frame is written at once.
      await vi.advanceTimersByTimeAsync(5000);
      hub.message(x.socket, Buffer.from(frame(false)));
      await vi.advanceTimersByTimeAsync(0);
      expect(screens()).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes an off frame's hidden_for_ms on; an on frame carries none (RR2, D1)", async () => {
    vi.useFakeTimers();
    try {
      const { hub, open, presence } = setup({}, { presenceCoalesceMs: 100 });
      const [ws, me] = [newId(), newId()];
      const x = open(ws, me);
      hub.message(
        x.socket,
        Buffer.from(
          JSON.stringify({ type: 'presence', v: 1, on_screen: false, hidden_for_ms: 60_000 }),
        ),
      );
      await vi.advanceTimersByTimeAsync(200);
      hub.message(
        x.socket,
        Buffer.from(
          JSON.stringify({ type: 'presence', v: 1, on_screen: true, hidden_for_ms: 60_000 }),
        ),
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(presence.calls.filter((c) => c.startsWith('screen'))).toEqual([
        `screen|${ws}|${connOf(presence)}|${me}|false|60000`,
        `screen|${ws}|${connOf(presence)}|${me}|true`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores junk, unknown types, extra fields, wrong versions and oversized frames without closing', async () => {
    vi.useFakeTimers();
    try {
      const { hub, open, presence } = setup({}, { presenceCoalesceMs: 100 });
      const x = open(newId(), newId());
      const junk = [
        'not json',
        '[]',
        'null',
        JSON.stringify({ type: 'bot.changed', v: 1 }),
        JSON.stringify({ type: 'presence', v: 2, on_screen: true }),
        JSON.stringify({ type: 'presence', v: 1, on_screen: 'yes' }),
        JSON.stringify({ type: 'presence', v: 1, on_screen: true, extra: 1 }),
        JSON.stringify({ type: 'presence', v: 1, on_screen: true, pad: 'x'.repeat(2000) }),
      ];
      for (const data of junk) hub.message(x.socket, Buffer.from(data));
      hub.message(x.socket, [Buffer.from('x')] as never);
      await vi.advanceTimersByTimeAsync(500);
      expect(presence.calls.filter((c) => c.startsWith('screen'))).toEqual([]);
      expect(x.socket.closed).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a frame from a detached socket writes nothing, and a pending write is dropped on close', async () => {
    vi.useFakeTimers();
    try {
      const { hub, open, presence } = setup({}, { presenceCoalesceMs: 100 });
      const x = open(newId(), newId());
      hub.message(x.socket, Buffer.from(frame(true)));
      hub.message(x.socket, Buffer.from(frame(false)));
      hub.detach(x.socket);
      hub.message(x.socket, Buffer.from(frame(true)));
      await vi.advanceTimersByTimeAsync(500);
      // Only the leading write of the first frame; the pending one died with the socket.
      expect(
        presence.calls.filter((c) => c.startsWith('screen')).map((c) => c.split('|')[4]),
      ).toEqual(['true']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failing presence write is logged by code only and never breaks the socket', async () => {
    const { hub, open, presence } = setup();
    presence.alive = () =>
      Promise.reject(Object.assign(new Error('secret detail'), { code: 'X1' }));
    const x = open(newId(), newId());
    hub.pong(x.socket);
    await new Promise((r) => setTimeout(r, 0));
    expect(x.socket.closed).toBeNull();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret detail');
  });

  it("runs a socket's presence calls in order: a close never overtakes the open", async () => {
    const { hub, open, presence } = setup();
    const order: string[] = [];
    presence.opened = async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('opened');
    };
    presence.closed = async () => {
      order.push('closed');
    };
    const x = open(newId(), newId());
    hub.detach(x.socket);
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(['opened', 'closed']);
  });
});
