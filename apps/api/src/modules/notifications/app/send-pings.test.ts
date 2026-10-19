import { describe, expect, it } from 'vitest';
import { PING_SPACING_MS, SWEEP_EVERY_MS, SWEEP_SEND_BUDGET_MS } from '../domain/constants.js';
import { pingText } from '../domain/ping-text.js';
import {
  fakePingRepo,
  fakePresenceRepo,
  fakeWaitingReads,
  notificationsHarness,
  T0,
} from './fakes.js';
import type { MemberSendOutcome, NewPresence } from './ports.js';
import { createSendPings } from './send-pings.js';

const W = '0199a000-0000-7000-8000-0000000000a1';
const W2 = '0199a000-0000-7000-8000-0000000000a2';
const A = '0199a000-0000-7000-8000-0000000000b1';
const B = '0199a000-0000-7000-8000-0000000000b2';
const C1 = '0199a000-0000-7000-8000-0000000000c1';
const C2 = '0199a000-0000-7000-8000-0000000000c2';
const C3 = '0199a000-0000-7000-8000-0000000000c3';
const PANEL = 'https://panel.example';
const MIN = 60_000;
const min = (m: number) => new Date(T0.getTime() + m * MIN);

function setup() {
  const h = notificationsHarness();
  h.setBot(W);
  h.addMember(W, A);
  h.addMember(W, B);
  const pings = fakePingRepo();
  const presence = fakePresenceRepo();
  const reads = fakeWaitingReads();
  const sent: { telegramUserId: bigint; text: string; pingAtCall: string | undefined }[] = [];
  const script: MemberSendOutcome[] = [];
  const logs: object[] = [];
  const hooks: { beforeLock?: () => void; onSend?: () => void } = {};
  const sweep = createSendPings({
    transaction: h.transaction,
    membership: {
      lockActiveMembers: async (tx, w, ids) => {
        hooks.beforeLock?.();
        return h.membership.lockActiveMembers(tx, w, ids);
      },
    },
    links: h.links,
    presence,
    pings,
    reads,
    bots: h.botPort,
    workspaces: { workspaceName: async (w) => (w === W ? 'Acme Flowers' : null) },
    send: async ({ telegramUserId, text }) => {
      sent.push({
        telegramUserId,
        text,
        pingAtCall: pings.rows.find((r) => r.accountId === accountOf(telegramUserId))?.outcome,
      });
      hooks.onSend?.();
      return script.shift() ?? { outcome: 'accepted' };
    },
    signals: h.signalPort,
    clock: h.clock,
    panelUrl: PANEL,
    logger: { info: (o) => logs.push(o) },
  });
  const users = new Map<bigint, string>();
  const accountOf = (u: bigint) => users.get(u);
  let n = 0;
  const link = (accountId: string, o: { workspaceId?: string; blockedAt?: Date } = {}) => {
    const telegramUserId = BigInt(1000 + ++n);
    users.set(telegramUserId, accountId);
    h.links.rows.push({
      id: `tl-${n}`,
      workspaceId: o.workspaceId ?? W,
      accountId,
      telegramBotId: 100001n,
      telegramUserId,
      displayName: 'Ann T',
      linkedAt: min(-60),
      blockedAt: o.blockedAt ?? null,
      lastNoticeAt: null,
      removedAt: null,
      removedReason: null,
    });
    return telegramUserId;
  };
  const waiting = (
    id: string,
    o: {
      since?: Date;
      assignee?: string | null;
      read?: string[];
      startedBy?: 'message' | 'reopen';
    } = {},
  ) =>
    reads.rows.push({
      workspaceId: W,
      conversationId: id,
      assigneeAccountId: o.assignee ?? null,
      waitingSince: o.since ?? T0,
      startedBy: o.startedBy ?? 'message',
      readBy: new Set(o.read ?? []),
    });
  const present = (accountId: string, o: { workspaceId?: string } = {}) => {
    const lease: NewPresence = {
      id: `p-${++n}`,
      accountId,
      liveUntil: min(60),
      onScreen: true,
      at: T0,
    };
    return presence.open(o.workspaceId ?? W, lease);
  };
  return { h, pings, presence, reads, sent, script, logs, hooks, sweep, link, waiting, present };
}

describe('runSweep (flow 12)', () => {
  it('pings an away assignee 5 minutes after the wait began, once, with the lens-less single link', async () => {
    const s = setup();
    const user = s.link(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(5));
    const result = await s.sweep.runSweep(W);
    expect(result.nextRunAt).toEqual(new Date(min(5).getTime() + SWEEP_EVERY_MS));
    const expected = pingText({
      workspaceName: 'Acme Flowers',
      workspaceId: W,
      panelUrl: PANEL,
      mine: 1,
      unassigned: 0,
      teammate: 0,
      longestWaitMinutes: 5,
      conversationId: C1,
    });
    expect(s.sent).toEqual([
      { telegramUserId: user, text: `${expected.text}\n${expected.url}`, pingAtCall: 'sending' },
    ]);
    expect(s.pings.rows).toMatchObject([
      { accountId: A, outcome: 'accepted', items: [{ conversationId: C1, waitingSince: T0 }] },
    ]);
    // The same period is never pinged again.
    s.h.clock.set(min(20));
    await s.sweep.runSweep(W);
    expect(s.sent).toHaveLength(1);
  });

  it('does not ping before the 5 minutes', async () => {
    const s = setup();
    s.link(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(new Date(min(5).getTime() - 1000));
    await s.sweep.runSweep(W);
    expect(s.sent).toEqual([]);
  });

  it('does not ping a member who is present on the web', async () => {
    const s = setup();
    s.link(A);
    await s.present(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(5));
    await s.sweep.runSweep(W);
    expect(s.sent).toEqual([]);
  });

  it('a lease that expired is deleted and the member counts as away', async () => {
    const s = setup();
    s.link(A);
    await s.present(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(61));
    await s.sweep.runSweep(W);
    expect(s.presence.rows).toEqual([]);
    expect(s.sent).toHaveLength(1);
  });

  it('skips a bot that does not work: nothing sent, nothing queued, the chain goes on in 20 s', async () => {
    for (const state of ['needs_token', 'disconnected'] as const) {
      const s = setup();
      s.h.setBot(W, { state });
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(6));
      expect(await s.sweep.runSweep(W)).toEqual({
        nextRunAt: new Date(min(6).getTime() + SWEEP_EVERY_MS),
      });
      expect(s.sent).toEqual([]);
      expect(s.pings.rows).toEqual([]);
    }
  });

  it('a workspace without a bot skips too', async () => {
    const s = setup();
    s.h.bots.delete(W);
    s.link(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(6));
    expect((await s.sweep.runSweep(W)).nextRunAt).not.toBeNull();
    expect(s.sent).toEqual([]);
  });

  it('waits out a send pause: next run at its end, nothing sent', async () => {
    const s = setup();
    s.h.setBot(W, { sendPausedUntil: min(9) });
    s.link(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(6));
    expect(await s.sweep.runSweep(W)).toEqual({ nextRunAt: min(9) });
    expect(s.sent).toEqual([]);
  });

  it('a taken-over bot still sends (shared-inbox AC-14)', async () => {
    const s = setup();
    s.h.setBot(W, { state: 'taken_over' });
    s.link(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(6));
    await s.sweep.runSweep(W);
    expect(s.sent).toHaveLength(1);
  });

  it('no live link: the chain ends', async () => {
    const s = setup();
    s.waiting(C1);
    s.h.clock.set(min(6));
    expect(await s.sweep.runSweep(W)).toEqual({ nextRunAt: null });
  });

  it('ignores the links of another workspace', async () => {
    const s = setup();
    s.link(A, { workspaceId: W2 });
    s.waiting(C1);
    s.h.clock.set(min(6));
    expect(await s.sweep.runSweep(W)).toEqual({ nextRunAt: null });
    expect(s.sent).toEqual([]);
  });

  it('combines conversations and keeps the 10-minute spacing, then sends one combined ping', async () => {
    const s = setup();
    s.link(A);
    s.waiting(C1, { assignee: A, since: T0 });
    s.h.clock.set(min(5));
    await s.sweep.runSweep(W);
    s.waiting(C2, { assignee: A, since: min(2) });
    s.waiting(C3, { assignee: A, since: min(3) });
    s.h.clock.set(min(9));
    await s.sweep.runSweep(W);
    expect(s.sent).toHaveLength(1);
    s.h.clock.set(new Date(min(5).getTime() + PING_SPACING_MS));
    await s.sweep.runSweep(W);
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]!.text).toContain('2 customers are waiting for your reply, the longest 13 min');
    expect(s.sent[1]!.text).toContain(`${PANEL}/w/${W}/inbox?assignee=mine`);
    expect(s.pings.rows[1]!.items.map((i) => i.conversationId)).toEqual([C2, C3]);
  });

  it('an unassigned conversation pings every away linked member who has not read it', async () => {
    const s = setup();
    s.link(A);
    s.link(B);
    s.waiting(C1, { read: [B] });
    s.h.clock.set(min(5));
    await s.sweep.runSweep(W);
    expect(s.pings.rows.map((r) => r.accountId)).toEqual([A]);
  });

  it('a teammate is reached at 30 minutes, or at 5 when the assignee has no link', async () => {
    const s = setup();
    s.link(B);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(min(5));
    await s.sweep.runSweep(W);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.text).toContain("a teammate's customer");
    const t = setup();
    t.link(A);
    t.link(B);
    t.waiting(C1, { assignee: A });
    t.h.clock.set(min(5));
    await t.sweep.runSweep(W);
    expect(t.pings.rows.map((r) => r.accountId)).toEqual([A]);
    t.h.clock.set(min(30));
    await t.sweep.runSweep(W);
    expect(t.pings.rows.map((r) => r.accountId)).toEqual([A, B]);
  });

  describe('the per-member send transaction re-checks at send time', () => {
    it('a conversation that stopped waiting meanwhile: no ping row, nothing sent', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.hooks.beforeLock = () => {
        s.reads.rows.length = 0;
      };
      await s.sweep.runSweep(W);
      expect(s.pings.rows).toEqual([]);
      expect(s.sent).toEqual([]);
    });

    it('read meanwhile drops out', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.hooks.beforeLock = () => {
        s.reads.rows[0]!.readBy.add(A);
      };
      await s.sweep.runSweep(W);
      expect(s.sent).toEqual([]);
    });

    it('the member came back to the web meanwhile', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.hooks.beforeLock = () => {
        void s.present(A);
      };
      await s.sweep.runSweep(W);
      expect(s.sent).toEqual([]);
    });

    it('a membership deactivated meanwhile: no ping', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.hooks.beforeLock = () => {
        s.h.members.get(W)!.delete(A);
      };
      await s.sweep.runSweep(W);
      expect(s.pings.rows).toEqual([]);
      expect(s.sent).toEqual([]);
    });

    it('a link removed meanwhile: no ping', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.hooks.beforeLock = () => {
        s.h.links.rows[0]!.removedAt = min(5);
      };
      await s.sweep.runSweep(W);
      expect(s.sent).toEqual([]);
    });

    it('the lock order is the membership first', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      await s.sweep.runSweep(W);
      expect(s.h.events[0]).toBe('lock-membership');
    });

    it('another worker won the ledger: no send', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      const insert = s.pings.insertWithItems;
      s.pings.insertWithItems = async (...args) => {
        // The rival's ping lands first.
        s.pings.rows.push({
          id: 'rival',
          workspaceId: W,
          accountId: A,
          telegramLinkId: 'tl-1',
          createdAt: min(5),
          outcome: 'sending',
          items: [{ conversationId: C1, waitingSince: T0 }],
        });
        return insert(...args);
      };
      await s.sweep.runSweep(W);
      expect(s.sent).toEqual([]);
      expect(s.pings.rows.map((r) => r.id)).toEqual(['rival']);
    });
  });

  it('stops sending once the sweep budget is spent and runs again at once, so a sweep ends well inside its job expiry (B3)', async () => {
    const s = setup();
    const [C, D] = ['0199a000-0000-7000-8000-0000000000b3', '0199a000-0000-7000-8000-0000000000b4'];
    s.h.addMember(W, C);
    s.h.addMember(W, D);
    for (const m of [A, B, C, D]) s.link(m);
    s.waiting(C1);
    s.h.clock.set(min(5));
    // Each send takes 12 s (a slow Telegram, under the 10 s timeout plus pacing).
    s.hooks.onSend = () => s.h.clock.advance(12_000);
    const result = await s.sweep.runSweep(W);
    expect(SWEEP_SEND_BUDGET_MS).toBe(30_000);
    expect(s.sent).toHaveLength(3);
    expect(result.nextRunAt).toEqual(new Date(min(5).getTime() + 36_000));
    // The next sweep picks up the member who was left.
    await s.sweep.runSweep(W);
    expect(s.sent).toHaveLength(4);
  });

  describe('outcomes (events.md table)', () => {
    it('accepted clears blocked_at and signals once', async () => {
      const s = setup();
      s.link(A, { blockedAt: min(-3) });
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      await s.sweep.runSweep(W);
      expect(s.h.links.rows[0]!.blockedAt).toBeNull();
      expect(s.h.signals).toEqual([{ workspaceId: W, accountId: A }]);
      expect(s.pings.rows[0]!.outcome).toBe('accepted');
    });

    it('accepted on a reachable link signals nothing', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      await s.sweep.runSweep(W);
      expect(s.h.signals).toEqual([]);
    });

    it('blocked counts for the period, marks the link not reachable, signals, and the loop continues', async () => {
      const s = setup();
      s.link(A);
      s.link(B);
      s.waiting(C1);
      s.h.clock.set(min(5));
      s.script.push({ outcome: 'blocked' });
      await s.sweep.runSweep(W);
      expect(s.pings.rows.map((r) => [r.accountId, r.outcome])).toEqual([
        [A, 'blocked'],
        [B, 'accepted'],
      ]);
      expect(s.h.links.rows[0]!.blockedAt).toEqual(min(5));
      expect(s.h.signals).toEqual([{ workspaceId: W, accountId: A }]);
      // The attempt is not retried.
      s.h.clock.set(min(20));
      await s.sweep.runSweep(W);
      expect(s.sent).toHaveLength(2);
    });

    it('a second block signals nothing and keeps the first time', async () => {
      const s = setup();
      s.link(A, { blockedAt: min(-9) });
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.script.push({ outcome: 'blocked' });
      await s.sweep.runSweep(W);
      expect(s.h.links.rows[0]!.blockedAt).toEqual(min(-9));
      expect(s.h.signals).toEqual([]);
    });

    it('rate_limited deletes the ping, stops the loop and resumes after the pause', async () => {
      const s = setup();
      s.link(A);
      s.link(B);
      s.waiting(C1);
      s.h.clock.set(min(5));
      s.script.push({ outcome: 'rate_limited', retryAfter: min(7) });
      expect(await s.sweep.runSweep(W)).toEqual({ nextRunAt: min(7) });
      expect(s.sent).toHaveLength(1);
      expect(s.pings.rows).toEqual([]);
      // The conversations are due again afterwards.
      s.h.clock.set(min(7));
      await s.sweep.runSweep(W);
      expect(s.pings.rows).toHaveLength(2);
    });

    it('bot_unavailable deletes the ping and stops the loop', async () => {
      const s = setup();
      s.link(A);
      s.link(B);
      s.waiting(C1);
      s.h.clock.set(min(5));
      s.script.push({ outcome: 'bot_unavailable' });
      await s.sweep.runSweep(W);
      expect(s.sent).toHaveLength(1);
      expect(s.pings.rows).toEqual([]);
    });

    it("the outcome touches only the link the ping went to, never the member's newer link (B6)", async () => {
      for (const [answer, blockedBefore] of [
        [{ outcome: 'blocked' }, null],
        [{ outcome: 'accepted' }, min(1)],
      ] as const) {
        const s = setup();
        s.link(A);
        s.waiting(C1, { assignee: A });
        s.h.clock.set(min(5));
        s.script.push(answer);
        // While the ping is in flight the member disconnects and connects again (a new link row).
        s.hooks.onSend = () => {
          const old = s.h.links.rows[0]!;
          old.removedAt = min(5);
          old.removedReason = 'member';
          s.h.links.rows.push({
            ...old,
            id: 'tl-new',
            telegramUserId: 9999n,
            blockedAt: blockedBefore,
            removedAt: null,
            removedReason: null,
          });
        };
        await s.sweep.runSweep(W);
        const fresh = s.h.links.rows.find((r) => r.id === 'tl-new')!;
        expect(fresh.blockedAt).toEqual(blockedBefore);
        expect(s.h.signals).toEqual([]);
      }
    });

    it('unknown (maybe delivered) is a failed attempt that counts and is never sent again', async () => {
      const s = setup();
      s.link(A);
      s.waiting(C1, { assignee: A });
      s.h.clock.set(min(5));
      s.script.push({ outcome: 'unknown' });
      await s.sweep.runSweep(W);
      expect(s.pings.rows.map((r) => [r.accountId, r.outcome])).toEqual([[A, 'failed']]);
      s.h.clock.set(min(20));
      await s.sweep.runSweep(W);
      expect(s.sent).toHaveLength(1);
    });

    it('transient is a failed attempt that counts, with no retry, and the loop continues', async () => {
      const s = setup();
      s.link(A);
      s.link(B);
      s.waiting(C1);
      s.h.clock.set(min(5));
      s.script.push({ outcome: 'transient' });
      await s.sweep.runSweep(W);
      expect(s.pings.rows.map((r) => [r.accountId, r.outcome])).toEqual([
        [A, 'failed'],
        [B, 'accepted'],
      ]);
      s.h.clock.set(min(20));
      await s.sweep.runSweep(W);
      expect(s.sent).toHaveLength(2);
    });
  });

  it('logs ids, outcome codes and timings - never the text or a name', async () => {
    const s = setup();
    s.link(A);
    s.waiting(C1, { assignee: A });
    s.h.clock.set(new Date(min(5).getTime() + 4000));
    await s.sweep.runSweep(W);
    const line = s.logs.find((l) => 'outcome' in l) as Record<string, unknown>;
    expect(line).toMatchObject({
      workspaceId: W,
      accountId: A,
      outcome: 'accepted',
      dueToAcceptedMs: 4000,
      pausedMs: 0,
    });
    expect(typeof line.pingId).toBe('string');
    const all = JSON.stringify(s.logs);
    expect(all).not.toContain('Acme');
    expect(all).not.toContain('waiting');
    expect(all).not.toContain('Ann T');
  });
});
