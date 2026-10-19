import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { isAway, isPresent } from '../domain/presence.js';
import { LEASE_MS, PRESENCE_WINDOW_MS } from '../domain/constants.js';
import { T0, at } from './fakes.js';
import type { PingRepo, PresenceRepo } from './ports.js';
import { createPresence } from './presence.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const W2 = '0199a000-0000-7000-8000-0000000000a2';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';

interface Row {
  workspaceId: string;
  id: string;
  accountId: string;
  liveUntil: Date;
  onScreen: boolean;
  lastOnScreenAt: Date | null;
}

/** In-memory tab_presences with the SQL's workspace scoping, GREATEST rules and cleanup. */
function fakePresenceRepo(): PresenceRepo & { rows: Row[] } {
  const rows: Row[] = [];
  const find = (w: string, id: string) => rows.find((r) => r.workspaceId === w && r.id === id);
  const later = (a: Date | null, b: Date) => (a && a > b ? a : b);
  return {
    rows,
    async open(w, lease) {
      rows.push({
        workspaceId: w,
        id: lease.id,
        accountId: lease.accountId,
        liveUntil: lease.liveUntil,
        onScreen: lease.onScreen,
        lastOnScreenAt: lease.onScreen ? lease.at : null,
      });
    },
    async extend(w, id, liveUntil) {
      const r = find(w, id);
      if (!r) return false;
      r.liveUntil = later(r.liveUntil, liveUntil);
      return true;
    },
    async setScreen(w, id, onScreen, when, hiddenSince) {
      const r = find(w, id);
      if (!r) return false;
      if (onScreen || r.onScreen) r.lastOnScreenAt = later(r.lastOnScreenAt, when);
      else if (r.lastOnScreenAt === null && hiddenSince) r.lastOnScreenAt = hiddenSince;
      r.onScreen = onScreen;
      return true;
    },
    async close(w, id) {
      const i = rows.findIndex((r) => r.workspaceId === w && r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async deleteExpired(w, now, accountId) {
      const keep = rows.filter(
        (r) =>
          !(
            r.workspaceId === w &&
            r.liveUntil <= now &&
            (accountId === undefined || r.accountId === accountId)
          ),
      );
      const n = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return n;
    },
    async listLive(w, now, accountIds) {
      const out = new Map<
        string,
        { liveUntil: Date; onScreen: boolean; lastOnScreenAt: Date | null }[]
      >();
      for (const r of rows) {
        if (r.workspaceId !== w || r.liveUntil <= now) continue;
        if (accountIds && !accountIds.includes(r.accountId)) continue;
        out.set(r.accountId, [...(out.get(r.accountId) ?? []), r]);
      }
      return out;
    },
  };
}

function setup() {
  const clock = fixedClock(T0);
  const presence = fakePresenceRepo();
  const opened: { workspaceId: string; accountId: string; now: Date }[] = [];
  const pings = {
    async markOpened(workspaceId: string, accountId: string, now: Date) {
      opened.push({ workspaceId, accountId, now });
      return true;
    },
  } as Pick<PingRepo, 'markOpened'> as PingRepo;
  const uc = createPresence({ presence, pings, clock });
  return { clock, presence, opened, uc };
}

describe('presence use cases (AC-07, ADR-0002)', () => {
  it('opened registers a 50 s lease, hidden by default semantics of the caller', async () => {
    const { presence, uc, opened } = setup();
    await uc.opened(W, A, 'c1', false);
    expect(presence.rows).toEqual([
      {
        workspaceId: W,
        id: 'c1',
        accountId: A,
        liveUntil: new Date(T0.getTime() + LEASE_MS),
        onScreen: false,
        lastOnScreenAt: null,
      },
    ]);
    // A tab that opens hidden does not count as a visit to a ping.
    expect(opened).toEqual([]);
  });

  it('a tab that never comes on screen counts away', async () => {
    const { presence, uc, clock } = setup();
    await uc.opened(W, A, 'c1', false);
    const leases = [...(await presence.listLive(W, clock.now())).get(A)!];
    expect(isAway(leases, clock.now())).toBe(true);
  });

  it("opened on screen marks the member's latest ping opened", async () => {
    const { uc, opened } = setup();
    await uc.opened(W, A, 'c1', true);
    expect(opened).toEqual([{ workspaceId: W, accountId: A, now: T0 }]);
  });

  it("opened deletes the same member's expired leases in that workspace only", async () => {
    const { presence, uc, clock } = setup();
    await uc.opened(W, A, 'old-a', true);
    await uc.opened(W, B, 'old-b', true);
    await uc.opened(W2, A, 'old-a2', true);
    clock.advance(LEASE_MS + 1000);
    await uc.opened(W, A, 'new-a', false);
    expect(presence.rows.map((r) => r.id).sort()).toEqual(['new-a', 'old-a2', 'old-b']);
  });

  it('alive extends the lease and never moves it back', async () => {
    const { presence, uc, clock } = setup();
    await uc.opened(W, A, 'c1', true);
    clock.advance(25_000);
    await uc.alive(W, 'c1');
    expect(presence.rows[0]!.liveUntil).toEqual(new Date(T0.getTime() + 25_000 + LEASE_MS));
    clock.set(T0);
    await uc.alive(W, 'c1');
    expect(presence.rows[0]!.liveUntil).toEqual(new Date(T0.getTime() + 25_000 + LEASE_MS));
  });

  it('alive for a missing lease or another workspace is a no-op', async () => {
    const { presence, uc } = setup();
    await uc.opened(W, A, 'c1', true);
    await uc.alive(W, 'gone');
    await uc.alive(W2, 'c1');
    expect(presence.rows[0]!.liveUntil).toEqual(new Date(T0.getTime() + LEASE_MS));
  });

  it('leaving the screen stamps last-on-screen: present for 10 minutes, then away', async () => {
    const { presence, uc, clock } = setup();
    await uc.opened(W, A, 'c1', true);
    clock.advance(20_000);
    await uc.screen(W, 'c1', A, false);
    expect(presence.rows[0]).toMatchObject({ onScreen: false, lastOnScreenAt: at(20) });
    const stillLive = async () => {
      await uc.alive(W, 'c1');
      return [...(await presence.listLive(W, clock.now())).get(A)!];
    };
    clock.advance(PRESENCE_WINDOW_MS - 2_000);
    expect(isPresent(await stillLive(), clock.now())).toBe(true);
    clock.advance(3_000);
    expect(isPresent(await stillLive(), clock.now())).toBe(false);
  });

  it('a tab that reconnects hidden keeps the time it left the screen: present until 10 minutes after (RR2, D1)', async () => {
    const { presence, uc, clock } = setup();
    // The tab left the screen a minute ago, then its socket reconnected (a new, never-on-screen lease).
    const left = new Date(T0.getTime() - 60_000);
    await uc.opened(W, A, 'c2', false);
    await uc.screen(W, 'c2', A, false, 60_000);
    expect(presence.rows[0]).toMatchObject({ onScreen: false, lastOnScreenAt: left });
    const stillLive = async () => {
      await uc.alive(W, 'c2');
      return [...(await presence.listLive(W, clock.now())).get(A)!];
    };
    clock.set(new Date(left.getTime() + PRESENCE_WINDOW_MS - 2_000));
    expect(isPresent(await stillLive(), clock.now())).toBe(true);
    clock.advance(3_000);
    expect(isPresent(await stillLive(), clock.now())).toBe(false);
  });

  it('the server turns hidden_for_ms into a time on its own clock, bounded to the last 10 min + lease', async () => {
    const { presence, uc } = setup();
    await uc.opened(W, A, 'now', false);
    await uc.screen(W, 'now', A, false, 0);
    expect(presence.rows[0]!.lastOnScreenAt).toEqual(T0);
    await uc.opened(W, A, 'old', false);
    await uc.screen(W, 'old', A, false, 24 * 3_600_000);
    expect(presence.rows[1]!.lastOnScreenAt).toEqual(
      new Date(T0.getTime() - PRESENCE_WINDOW_MS - LEASE_MS),
    );
  });

  it('hidden_for_ms never rewrites a lease with on-screen history', async () => {
    const { presence, uc, clock } = setup();
    await uc.opened(W, A, 'c1', true);
    clock.advance(20_000);
    await uc.screen(W, 'c1', A, false, 60_000);
    expect(presence.rows[0]!.lastOnScreenAt).toEqual(at(20));
    clock.advance(20_000);
    await uc.screen(W, 'c1', A, false, 60_000);
    expect(presence.rows[0]!.lastOnScreenAt).toEqual(at(20));
  });

  it('coming back on screen marks the latest ping opened', async () => {
    const { uc, opened, clock } = setup();
    await uc.opened(W, A, 'c1', false);
    clock.advance(14 * 60_000);
    await uc.screen(W, 'c1', A, true);
    expect(opened).toEqual([{ workspaceId: W, accountId: A, now: clock.now() }]);
  });

  it('going off screen does not mark a ping', async () => {
    const { uc, opened } = setup();
    await uc.opened(W, A, 'c1', false);
    await uc.screen(W, 'c1', A, false);
    expect(opened).toEqual([]);
  });

  it('a screen frame for a lease that is gone marks nothing', async () => {
    const { uc, opened } = setup();
    await uc.screen(W, 'gone', A, true);
    expect(opened).toEqual([]);
  });

  it('closed deletes only that lease in that workspace', async () => {
    const { presence, uc } = setup();
    await uc.opened(W, A, 'c1', true);
    await uc.opened(W, A, 'c2', true);
    await uc.closed(W2, 'c1');
    expect(presence.rows).toHaveLength(2);
    await uc.closed(W, 'c1');
    expect(presence.rows.map((r) => r.id)).toEqual(['c2']);
    await uc.closed(W, 'c1');
    expect(presence.rows).toHaveLength(1);
  });
});
