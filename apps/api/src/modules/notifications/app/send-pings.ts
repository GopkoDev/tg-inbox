import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import {
  PING_SPACING_MS,
  SWEEP_EVERY_MS,
  SWEEP_SEND_BUDGET_MS,
  TEAM_AFTER_MS,
  WAIT_AFTER_MS,
} from '../domain/constants.js';
import { dueSets, type MemberDue } from '../domain/due.js';
import { pingText } from '../domain/ping-text.js';
import type {
  BotReadiness,
  Executor,
  MembershipLocks,
  NotificationSignals,
  PingRepo,
  PresenceRepo,
  SendMemberMessage,
  TelegramLink,
  TelegramLinkRepo,
  Transaction,
  WaitingReads,
  WorkspaceNames,
} from './ports.js';

export interface SendPingsDeps {
  transaction: Transaction;
  membership: MembershipLocks;
  links: Pick<
    TelegramLinkRepo,
    'listLive' | 'findLiveByAccount' | 'findById' | 'markBlocked' | 'clearBlocked'
  >;
  presence: Pick<PresenceRepo, 'deleteExpired' | 'listLive'>;
  pings: PingRepo;
  reads: WaitingReads;
  bots: Pick<BotReadiness, 'pingReadiness'>;
  workspaces: WorkspaceNames;
  send: SendMemberMessage;
  signals: NotificationSignals;
  clock: Clock;
  /** The panel's base address (`PUBLIC_WEB_URL`). */
  panelUrl: string;
  logger?: { info(obj: object, msg: string): void };
}

export interface SweepResult {
  /** When the next sweep of this workspace runs; null when it has no live link (the chain ends). */
  nextRunAt: Date | null;
}

export interface SendPings {
  /**
   * One sweep of a workspace (flows 12, 13): skips while the bot does not work, waits out its send
   * pause, then sends every away member whose conversations are due and whose 10-minute spacing
   * allows it, one member at a time. Never lets a ping hold up a customer reply: it only calls the
   * paced member send, which never takes the reply path's capacity and stops at the first Telegram
   * limit.
   */
  runSweep(workspaceId: string): Promise<SweepResult>;
}

interface Prepared {
  pingId: string;
  link: TelegramLink;
  due: MemberDue;
  dueAt: Date;
}

export function createSendPings(deps: SendPingsDeps): SendPings {
  const { transaction, membership, links, presence, pings, reads, bots, workspaces, send } = deps;
  const { signals, clock, panelUrl, logger } = deps;

  /** The workspace's due sets from fresh reads; `only` narrows to one member's candidate conversations. */
  async function compute(
    workspaceId: string,
    now: Date,
    live: readonly TelegramLink[],
    only: { conversationIds: string[]; accountId: string } | null,
    tx?: Executor,
  ): Promise<MemberDue[]> {
    const accountIds = only ? [only.accountId] : live.map((l) => l.accountId);
    const waiting = await reads.waitingForPings(
      workspaceId,
      { ...(only && { conversationIds: only.conversationIds }), accountIds },
      tx,
    );
    if (waiting.length === 0) return [];
    const whose = new Set(accountIds);
    for (const c of waiting) if (c.assigneeAccountId) whose.add(c.assigneeAccountId);
    const periods = waiting.map((c) => ({
      conversationId: c.conversationId,
      waitingSince: c.waitingSince,
    }));
    const lastPingAt = new Map<string, Date>();
    for (const accountId of accountIds) {
      const last = await pings.lastPingAt(workspaceId, accountId, tx);
      if (last) lastPingAt.set(accountId, last);
    }
    return dueSets({
      now,
      conversations: waiting.map((c) => ({
        id: c.conversationId,
        waitingSince: c.waitingSince,
        startedBy: c.startedBy,
        assigneeAccountId: c.assigneeAccountId,
        readBy: c.readBy,
      })),
      linkedMembers: live.map((l) => ({
        accountId: l.accountId,
        notReachable: l.blockedAt !== null,
      })),
      presence: await presence.listLive(workspaceId, now, [...whose], tx),
      ledger: await pings.ledger(workspaceId, periods, tx),
      lastPingAt,
    });
  }

  /**
   * The member's send transaction (sad.md §8): the membership `FOR SHARE`, the member's advisory lock
   * `pings:<ws>:<account>` (two sweeps - one past its job expiry and the cron's new one, or two
   * instances - prepare one member one at a time, so the spacing re-check sees the other's ping), the
   * link row `FOR SHARE` (a Disconnect waits for the commit), a fresh recompute, then the ledger
   * insert. Every read joins the transaction: it never waits on a second pool connection while it
   * holds these locks. Commits before anything is sent. Null when nothing is due any more.
   */
  async function prepare(workspaceId: string, candidate: MemberDue): Promise<Prepared | null> {
    return transaction(async (tx) => {
      const { accountId } = candidate;
      const active = await membership.lockActiveMembers(tx, workspaceId, [accountId]);
      if (!active.includes(accountId)) return null;
      await pings.lockMember(workspaceId, accountId, tx);
      const link = await links.findLiveByAccount(workspaceId, accountId, { lock: 'share' }, tx);
      if (!link) return null;
      const now = clock.now();
      const live = await links.listLive(workspaceId, tx);
      const fresh = (
        await compute(
          workspaceId,
          now,
          live,
          { conversationIds: candidate.items.map((i) => i.conversationId), accountId },
          tx,
        )
      ).find((d) => d.accountId === accountId);
      if (!fresh || !fresh.sendNow || fresh.items.length === 0) return null;

      const previous = await pings.lastPingAt(workspaceId, accountId, tx);
      const pingId = newId();
      const inserted = await pings.insertWithItems(
        workspaceId,
        { id: pingId, accountId, telegramLinkId: link.id, createdAt: now },
        fresh.items.map((i) => ({
          conversationId: i.conversationId,
          waitingSince: i.waitingSince,
        })),
        tx,
      );
      if (inserted === 'lost') return null;
      return { pingId, link, due: fresh, dueAt: dueMoment(fresh, previous) };
    });
  }

  /**
   * The moment this ping became due: the earliest item's mark (5 min, a teammate's 30), or the end of
   * the member's 10-minute spacing when that came later.
   */
  function dueMoment(due: MemberDue, previousPingAt: Date | null): Date {
    const mark = Math.min(
      ...due.items.map(
        (i) => i.waitingSince.getTime() + (i.kind === 'teammate' ? TEAM_AFTER_MS : WAIT_AFTER_MS),
      ),
    );
    return new Date(
      Math.max(mark, previousPingAt ? previousPingAt.getTime() + PING_SPACING_MS : 0),
    );
  }

  async function sendOne(
    workspaceId: string,
    workspaceName: string,
    candidate: MemberDue,
    bot: { sendPausedUntil: Date | null },
  ): Promise<{ stop: Date | null }> {
    const prepared = await prepare(workspaceId, candidate);
    if (!prepared) return { stop: null };
    const { pingId, link, due } = prepared;
    const accountId = link.accountId;

    if (link.telegramUserId === null) {
      // Nothing to send to; the conversations stay due.
      await transaction((tx) => pings.rollOut(workspaceId, pingId, tx));
      return { stop: null };
    }
    const count = (kind: 'mine' | 'unassigned' | 'teammate') =>
      due.items.filter((i) => i.kind === kind).length;
    const sentAt = clock.now();
    const oldest = Math.min(...due.items.map((i) => i.waitingSince.getTime()));
    const message = pingText({
      workspaceName,
      workspaceId,
      panelUrl,
      mine: count('mine'),
      unassigned: count('unassigned'),
      teammate: count('teammate'),
      longestWaitMinutes: Math.floor((sentAt.getTime() - oldest) / 60_000),
      ...(due.items.length === 1 && { conversationId: due.items[0]!.conversationId }),
    });

    const outcome = await send({
      workspaceId,
      telegramUserId: link.telegramUserId,
      text: `${message.text}\n${message.url}`,
    });

    const liveTarget = async (tx: Executor) => {
      const target = await links.findById(workspaceId, link.id, tx);
      return target && target.removedAt === null ? target : null;
    };
    let stop: Date | null = null;
    await transaction(async (tx) => {
      switch (outcome.outcome) {
        case 'accepted': {
          await pings.setOutcome(workspaceId, pingId, 'accepted', tx);
          // Only the link the ping went to, and only while it is still live: a link made after a
          // Disconnect during the send is another chat whose reachability this answer says nothing of.
          const target = await liveTarget(tx);
          if (target?.blockedAt && (await links.clearBlocked(workspaceId, target.id, tx))) {
            await signals.telegramLinkChanged(tx, workspaceId, accountId);
          }
          return;
        }
        case 'blocked': {
          await pings.setOutcome(workspaceId, pingId, 'blocked', tx);
          const target = await liveTarget(tx);
          if (target) {
            const first = target.blockedAt === null;
            await links.markBlocked(workspaceId, target.id, clock.now(), tx);
            if (first) await signals.telegramLinkChanged(tx, workspaceId, accountId);
          }
          return;
        }
        case 'rate_limited':
          // The conversations stay due; `bots` stored the pause.
          await pings.rollOut(workspaceId, pingId, tx);
          stop = outcome.retryAfter;
          return;
        case 'bot_unavailable':
          await pings.rollOut(workspaceId, pingId, tx);
          stop = new Date(clock.now().getTime() + SWEEP_EVERY_MS);
          return;
        case 'transient':
        case 'unknown':
          // The attempt counts for the period and is not retried (an unknown one may have arrived).
          await pings.setOutcome(workspaceId, pingId, 'failed', tx);
          return;
      }
    });

    const acceptedAt = clock.now();
    const pausedMs = bot.sendPausedUntil
      ? Math.max(
          0,
          Math.min(bot.sendPausedUntil.getTime(), acceptedAt.getTime()) - prepared.dueAt.getTime(),
        )
      : 0;
    logger?.info(
      {
        workspaceId,
        accountId,
        pingId,
        outcome: outcome.outcome,
        dueToAcceptedMs: Math.max(0, acceptedAt.getTime() - prepared.dueAt.getTime() - pausedMs),
        pausedMs,
      },
      'ping',
    );
    return { stop };
  }

  return {
    async runSweep(workspaceId) {
      const started = clock.now();
      const live = await links.listLive(workspaceId);
      if (live.length === 0) return { nextRunAt: null };
      const regular = new Date(started.getTime() + SWEEP_EVERY_MS);

      const bot = await bots.pingReadiness(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) {
        // Nothing is sent or queued while the bot does not work; what is still waiting is due again later.
        return { nextRunAt: regular };
      }
      if (bot.sendPausedUntil && bot.sendPausedUntil.getTime() > started.getTime()) {
        return { nextRunAt: bot.sendPausedUntil };
      }

      // Read before any send transaction opens, so none of them waits on it.
      const workspaceName = await workspaces.workspaceName(workspaceId);
      // The workspace is gone: nothing to send; the next sweep finds no live link and ends the chain.
      if (workspaceName === null) return { nextRunAt: regular };

      await presence.deleteExpired(workspaceId, started);
      const dues = await compute(workspaceId, started, live, null);

      let nextRunAt = regular;
      for (const due of dues) {
        if (!due.sendNow) {
          const soonest = Math.max(due.allowedAt.getTime(), started.getTime() + 1000);
          if (soonest < nextRunAt.getTime()) nextRunAt = new Date(soonest);
          continue;
        }
        // The budget keeps the whole sweep - plus one send in flight - well inside the job's expiry,
        // so the cron never starts a second sweep beside a live one; the rest go in the next run, now.
        const now = clock.now();
        if (now.getTime() - started.getTime() >= SWEEP_SEND_BUDGET_MS) return { nextRunAt: now };
        const { stop } = await sendOne(workspaceId, workspaceName, due, bot);
        if (stop) return { nextRunAt: stop };
      }
      return { nextRunAt };
    },
  };
}
