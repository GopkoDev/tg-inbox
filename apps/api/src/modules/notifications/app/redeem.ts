import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { hashToken, isUsable } from '../domain/connect-link.js';
import type {
  CannotConnectReasonValue,
  ConnectLinkRepo,
  EnqueueBotMessage,
  Executor,
  MembershipLocks,
  NotificationSignals,
  TelegramLinkRepo,
  Transaction,
} from './ports.js';

export interface RedeemDeps {
  transaction: Transaction;
  membership: MembershipLocks;
  links: TelegramLinkRepo;
  connectLinks: ConnectLinkRepo;
  signals: NotificationSignals;
  enqueue: EnqueueBotMessage;
  /** Starts the workspace's ping chain in the caller's transaction; a live chain absorbs it. */
  startPings: (tx: Executor, workspaceId: string) => Promise<void>;
  clock: Clock;
}

export interface RedeemInput {
  /** The workspace of the bot whose webhook authenticated the update. */
  workspaceId: string;
  telegramBotId: bigint;
  from: { id: bigint; displayName: string };
  /** The 43-character token of `/start tgi_<token>`. */
  token: string;
  at: Date;
}

export type RedeemOutcome =
  | { outcome: 'linked' }
  | { outcome: 'already_connected' }
  | { outcome: 'cannot_connect'; reason: CannotConnectReasonValue }
  | { outcome: 'link_expired' };

export interface Redeem {
  redeem(input: RedeemInput): Promise<RedeemOutcome>;
}

/** A partial unique index refused our insert: the transaction is aborted, decide again from the winner. */
class UniquenessRace extends Error {}

const MAX_ATTEMPTS = 3;

/**
 * A connect-link start (seeded flow 2). Never throws for a refusal: every outcome is a bot answer and
 * every refusal but "no such link" uses the link up (AC-05, AC-06).
 *
 * Lock order (sad.md §8): a plain read of the link by hash -> the membership `FOR SHARE`
 * (`lockActiveMembers`) -> the connect-link row `FOR UPDATE` -> the link write. The membership comes
 * before the connect link, the order deactivation uses (workspace `FOR NO KEY UPDATE` -> membership
 * `UPDATE` -> conversations -> connect links / telegram links), so the two never wait on each other in
 * a circle. Two redeems may both pass the reads and insert; the second waits on the partial unique
 * index and gets the conflict, aborting its transaction, so it is decided again in a fresh one.
 * The Telegram user id and the token are never logged here.
 */
export function createRedeem(deps: RedeemDeps): Redeem {
  const { transaction, membership, links, connectLinks, signals, enqueue, startPings, clock } =
    deps;

  async function attempt(input: RedeemInput, tx: Executor): Promise<RedeemOutcome> {
    const { workspaceId, from } = input;
    const now = clock.now();
    const expired = async (): Promise<RedeemOutcome> => {
      await enqueue(tx, workspaceId, { kind: 'link_expired', telegramUserId: from.id });
      return { outcome: 'link_expired' };
    };

    const found = await connectLinks.findByHash(workspaceId, hashToken(input.token), tx);
    if (!found) return expired();

    const active = await membership.lockActiveMembers(tx, workspaceId, [found.accountId]);
    const link = await connectLinks.lockById(workspaceId, found.id, tx);
    if (!link || !isUsable(link, now)) return expired();
    // Every outcome below uses the link up.
    await connectLinks.markUsed(workspaceId, link.id, now, tx);
    if (!active.includes(link.accountId)) return expired();

    const refuse = async (reason: CannotConnectReasonValue): Promise<RedeemOutcome> => {
      await enqueue(tx, workspaceId, {
        kind: 'cannot_connect',
        telegramUserId: from.id,
        reason,
      });
      return { outcome: 'cannot_connect', reason };
    };

    const own = await links.findLiveByAccount(workspaceId, link.accountId, {}, tx);
    if (own) {
      if (own.telegramUserId === from.id) {
        await enqueue(tx, workspaceId, { kind: 'already_connected', telegramLinkId: own.id });
        return { outcome: 'already_connected' };
      }
      return refuse('member_linked_elsewhere');
    }
    if (await links.findLiveByTelegramUser(workspaceId, from.id, tx)) {
      return refuse('telegram_linked_to_teammate');
    }

    const id = newId();
    const inserted = await links.insert(
      workspaceId,
      {
        id,
        accountId: link.accountId,
        telegramBotId: input.telegramBotId,
        telegramUserId: from.id,
        displayName: from.displayName,
        linkedAt: now,
      },
      tx,
    );
    if (!inserted.ok) throw new UniquenessRace();
    await signals.telegramLinkChanged(tx, workspaceId, link.accountId);
    await enqueue(tx, workspaceId, { kind: 'connected', telegramLinkId: id });
    // A new link does not wait for the minute cron: its chain starts with the commit.
    await startPings(tx, workspaceId);
    return { outcome: 'linked' };
  }

  return {
    async redeem(input) {
      for (let tries = 1; ; tries += 1) {
        try {
          return await transaction((tx) => attempt(input, tx));
        } catch (err) {
          if (!(err instanceof UniquenessRace) || tries >= MAX_ATTEMPTS) throw err;
        }
      }
    },
  };
}
