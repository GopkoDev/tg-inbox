import { fixedClock } from '../../../platform/clock.js';
import type {
  BotMessage,
  BotReadiness,
  ConnectLink,
  ConnectLinkRepo,
  Executor,
  MembershipLocks,
  LedgerEntry,
  NewPing,
  NewPresence,
  NewTelegramLink,
  PingOutcome,
  PingPeriod,
  PingRepo,
  PresenceRepo,
  WaitingRead,
  WaitingReads,
  NotificationSignals,
  TelegramLink,
  TelegramLinkRepo,
  Transaction,
} from './ports.js';
import type { InboxBotStatus } from '@tg/shared';
import type { PresenceLease } from '../domain/presence.js';

export const T0 = new Date('2026-10-19T10:00:00Z');
export const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const same = (a: Buffer, b: Buffer) => a.equals(b);

/** In-memory telegram_links: the tenancy filter and both live-uniqueness rules of the SQL. */
export function fakeTelegramLinkRepo(): TelegramLinkRepo & { rows: TelegramLink[] } {
  const rows: TelegramLink[] = [];
  const live = (w: string) => rows.filter((r) => r.workspaceId === w && r.removedAt === null);
  const find = (w: string, id: string) => rows.find((r) => r.workspaceId === w && r.id === id);
  return {
    rows,
    async findLiveByAccount(w, accountId) {
      return live(w).find((r) => r.accountId === accountId) ?? null;
    },
    async findLiveByTelegramUser(w, telegramUserId) {
      return live(w).find((r) => r.telegramUserId === telegramUserId) ?? null;
    },
    async findById(w, id) {
      return find(w, id) ?? null;
    },
    async listLive(w) {
      return live(w);
    },
    async insert(w, link: NewTelegramLink) {
      if (live(w).some((r) => r.accountId === link.accountId)) {
        return { ok: false, reason: 'account_linked' };
      }
      if (live(w).some((r) => r.telegramUserId === link.telegramUserId)) {
        return { ok: false, reason: 'telegram_user_linked' };
      }
      rows.push({
        ...link,
        workspaceId: w,
        blockedAt: null,
        lastNoticeAt: null,
        removedAt: null,
        removedReason: null,
      });
      return { ok: true };
    },
    async remove(w, id, reason, now) {
      const row = find(w, id);
      if (!row || row.removedAt !== null) return false;
      row.removedAt = now;
      row.removedReason = reason;
      row.displayName = null;
      if (reason !== 'member') row.telegramUserId = null;
      return true;
    },
    async markBlocked(w, id, now) {
      const row = find(w, id);
      if (!row || row.removedAt !== null) return false;
      row.blockedAt ??= now;
      return true;
    },
    async clearBlocked(w, id) {
      const row = find(w, id);
      if (!row || row.removedAt !== null || row.blockedAt === null) return false;
      row.blockedAt = null;
      return true;
    },
    async claimNotice(w, id, now) {
      const row = find(w, id);
      if (!row || row.removedAt !== null) return false;
      if (row.lastNoticeAt && now.getTime() - row.lastNoticeAt.getTime() < 3_600_000) return false;
      row.lastNoticeAt = now;
      return true;
    },
    async clearRemovedUserId(w, id) {
      const row = find(w, id);
      if (!row || row.removedAt === null || row.telegramUserId === null) return false;
      row.telegramUserId = null;
      return true;
    },
    async listLiveWithOtherBot(w, telegramBotId) {
      return live(w).filter((r) => r.telegramBotId !== telegramBotId);
    },
    async workspacesWithLiveLink() {
      return [...new Set(rows.filter((r) => r.removedAt === null).map((r) => r.workspaceId))];
    },
  };
}

/** In-memory connect_links. */
export function fakeConnectLinkRepo(): ConnectLinkRepo & {
  rows: (ConnectLink & { tokenHash: Buffer })[];
  /** Account ids whose issuing lock was taken, in order. */
  locks: string[];
} {
  const rows: (ConnectLink & { tokenHash: Buffer })[] = [];
  const locks: string[] = [];
  const strip = (r: ConnectLink & { tokenHash: Buffer }): ConnectLink => {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      accountId: r.accountId,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt,
      replacedAt: r.replacedAt,
    };
  };
  return {
    rows,
    locks,
    async findByHash(w, hash) {
      const row = rows.find((r) => r.workspaceId === w && same(r.tokenHash, hash));
      return row ? strip(row) : null;
    },
    async lockById(w, id) {
      const row = rows.find((r) => r.workspaceId === w && r.id === id);
      return row ? strip(row) : null;
    },
    async lockIssuing(w, accountId) {
      locks.push(`${w}:${accountId}`);
    },
    async countSince(w, accountId, since) {
      const mine = rows
        .filter((r) => r.workspaceId === w && r.accountId === accountId && r.createdAt > since)
        .map((r) => r.createdAt.getTime());
      return {
        count: mine.length,
        oldestCreatedAt: mine.length ? new Date(Math.min(...mine)) : null,
      };
    },
    async markUnusedReplaced(w, accountId, now) {
      let n = 0;
      for (const r of rows) {
        if (r.workspaceId === w && r.accountId === accountId && !r.usedAt && !r.replacedAt) {
          r.replacedAt = now;
          n += 1;
        }
      }
      return n;
    },
    async insert(w, link) {
      rows.push({
        id: link.id,
        workspaceId: w,
        accountId: link.accountId,
        tokenHash: link.tokenHash,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        usedAt: null,
        replacedAt: null,
      });
    },
    async markUsed(w, id, now) {
      const row = rows.find((r) => r.workspaceId === w && r.id === id);
      if (!row || row.usedAt || row.replacedAt) return false;
      row.usedAt = now;
      return true;
    },
  };
}

export interface FakeBot {
  state: 'connected' | 'needs_token' | 'taken_over' | 'disconnected';
  telegramBotId: bigint;
  username: string;
  sendPausedUntil: Date | null;
}

/** Everything the notifications use cases call, with recorders for the signals and jobs. */
export function notificationsHarness() {
  const clock = fixedClock(T0);
  const links = fakeTelegramLinkRepo();
  const connectLinks = fakeConnectLinkRepo();
  /** Active members by workspace id. */
  const members = new Map<string, Set<string>>();
  const bots = new Map<string, FakeBot>();
  const signals: { workspaceId: string; accountId: string }[] = [];
  const jobs: { workspaceId: string; message: BotMessage }[] = [];
  const events: string[] = [];
  let seed = 0;

  /**
   * Runs `fn`; when it throws, undoes the connect-link state changes and the signals and jobs it
   * made (the writes of other, already committed transactions stay).
   */
  const transaction: Transaction = async (fn) => {
    const marks = connectLinks.rows.map((r) => ({ r, usedAt: r.usedAt, replacedAt: r.replacedAt }));
    const sizes = { rows: connectLinks.rows.length, signals: signals.length, jobs: jobs.length };
    try {
      return await fn({} as Executor);
    } catch (err) {
      for (const m of marks) {
        m.r.usedAt = m.usedAt;
        m.r.replacedAt = m.replacedAt;
      }
      connectLinks.rows.length = sizes.rows;
      signals.length = sizes.signals;
      jobs.length = sizes.jobs;
      throw err;
    }
  };
  const membership: MembershipLocks = {
    async lockActiveMembers(_tx, w, accountIds) {
      events.push('lock-membership');
      return accountIds.filter((a) => members.get(w)?.has(a));
    },
  };
  const botPort: BotReadiness = {
    async inboxBotStatus(w) {
      const b = bots.get(w);
      const state = !b || b.state === 'disconnected' ? 'not_connected' : b.state;
      return {
        workspace_id: w,
        state,
        can_reply: state === 'connected' || state === 'taken_over',
        receiving: state === 'connected',
      } satisfies InboxBotStatus;
    },
    async pingReadiness(w) {
      const b = bots.get(w);
      return b ? { ...b } : null;
    },
  };
  const signalPort: NotificationSignals = {
    async telegramLinkChanged(_tx, workspaceId, accountId) {
      signals.push({ workspaceId, accountId });
    },
  };
  return {
    clock,
    links,
    connectLinks,
    members,
    bots,
    signals,
    jobs,
    events,
    transaction,
    membership,
    botPort,
    signalPort,
    enqueue: async (_tx: Executor, workspaceId: string, message: BotMessage) => {
      jobs.push({ workspaceId, message });
    },
    /** Deterministic "random": a different 32 bytes per call. */
    randomBytes: (n: number) => new Uint8Array(n).fill(++seed),
    addMember(workspaceId: string, accountId: string) {
      if (!members.has(workspaceId)) members.set(workspaceId, new Set());
      members.get(workspaceId)!.add(accountId);
    },
    setBot(workspaceId: string, bot: Partial<FakeBot> = {}) {
      bots.set(workspaceId, {
        state: 'connected',
        telegramBotId: 100001n,
        username: 'acme_bot',
        sendPausedUntil: null,
        ...bot,
      });
    },
  };
}
export type NotificationsHarness = ReturnType<typeof notificationsHarness>;

export interface FakePing extends NewPing {
  workspaceId: string;
  outcome: PingOutcome;
  items: PingPeriod[];
}

/** In-memory pings + ping_items: the ledger's unique key and the cascade of the SQL. */
export function fakePingRepo(): PingRepo & { rows: FakePing[] } {
  const rows: FakePing[] = [];
  return {
    rows,
    async insertWithItems(w, ping, items) {
      const taken = (item: PingPeriod) =>
        rows.some(
          (r) =>
            r.workspaceId === w &&
            r.accountId === ping.accountId &&
            r.items.some(
              (i) =>
                i.conversationId === item.conversationId &&
                i.waitingSince.getTime() === item.waitingSince.getTime(),
            ),
        );
      if (items.some(taken)) return 'lost';
      rows.push({ ...ping, workspaceId: w, outcome: 'sending', items });
      return 'inserted';
    },
    async lastPingAt(w, accountId) {
      const times = rows
        .filter((r) => r.workspaceId === w && r.accountId === accountId)
        .map((r) => r.createdAt.getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    },
    async ledger(w, periods) {
      const out: LedgerEntry[] = [];
      for (const r of rows) {
        if (r.workspaceId !== w) continue;
        for (const i of r.items) {
          if (
            periods.some(
              (p) =>
                p.conversationId === i.conversationId &&
                p.waitingSince.getTime() === i.waitingSince.getTime(),
            )
          ) {
            out.push({ ...i, accountId: r.accountId });
          }
        }
      }
      return out;
    },
    async setOutcome(w, pingId, outcome) {
      const row = rows.find((r) => r.workspaceId === w && r.id === pingId);
      if (row) row.outcome = outcome;
      return Boolean(row);
    },
    async rollOut(w, pingId) {
      const at = rows.findIndex((r) => r.workspaceId === w && r.id === pingId);
      if (at >= 0) rows.splice(at, 1);
      return at >= 0;
    },
    async markOpened() {
      return false;
    },
  };
}

interface FakeLease extends PresenceLease {
  workspaceId: string;
  id: string;
  accountId: string;
}

/** In-memory tab_presences. */
export function fakePresenceRepo(): PresenceRepo & { rows: FakeLease[] } {
  const rows: FakeLease[] = [];
  const find = (w: string, id: string) => rows.find((r) => r.workspaceId === w && r.id === id);
  return {
    rows,
    async open(w, lease: NewPresence) {
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
      const row = find(w, id);
      if (!row) return false;
      if (liveUntil > row.liveUntil) row.liveUntil = liveUntil;
      return true;
    },
    async setScreen(w, id, onScreen, now) {
      const row = find(w, id);
      if (!row) return false;
      row.onScreen = onScreen;
      row.lastOnScreenAt = now;
      return true;
    },
    async close(w, id) {
      const at = rows.findIndex((r) => r.workspaceId === w && r.id === id);
      if (at >= 0) rows.splice(at, 1);
      return at >= 0;
    },
    async deleteExpired(w, now, accountId) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const r = rows[i]!;
        if (
          r.workspaceId === w &&
          r.liveUntil <= now &&
          (!accountId || r.accountId === accountId)
        ) {
          rows.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
    async listLive(w, now, accountIds) {
      const out = new Map<string, PresenceLease[]>();
      for (const r of rows) {
        if (r.workspaceId !== w || r.liveUntil <= now) continue;
        if (accountIds && !accountIds.includes(r.accountId)) continue;
        out.set(r.accountId, [
          ...(out.get(r.accountId) ?? []),
          { liveUntil: r.liveUntil, onScreen: r.onScreen, lastOnScreenAt: r.lastOnScreenAt },
        ]);
      }
      return out;
    },
  };
}

export interface FakeWaiting extends WaitingRead {
  workspaceId: string;
}

/** The waiting conversations of `conversations`, as a list a test edits between reads. */
export function fakeWaitingReads(): WaitingReads & { rows: FakeWaiting[]; reads: number } {
  const state = {
    rows: [] as FakeWaiting[],
    reads: 0,
    async waitingForPings(
      w: string,
      query: { conversationIds?: string[]; accountIds: string[] },
    ): Promise<WaitingRead[]> {
      state.reads += 1;
      return state.rows
        .filter(
          (r) =>
            r.workspaceId === w &&
            (!query.conversationIds || query.conversationIds.includes(r.conversationId)),
        )
        .map((r): WaitingRead => ({
          conversationId: r.conversationId,
          assigneeAccountId: r.assigneeAccountId,
          waitingSince: r.waitingSince,
          startedBy: r.startedBy,
          readBy: new Set(r.readBy),
        }));
    },
  };
  return state;
}
