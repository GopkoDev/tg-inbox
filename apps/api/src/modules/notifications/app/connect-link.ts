import type { IssuedConnectLink } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  AccessRemovedError,
  ConnectLinkLimitReachedError,
  PingsNeedWorkingBotError,
  TelegramAlreadyLinkedError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import {
  CONNECT_LINK_LIMIT,
  CONNECT_LINK_TTL_MS,
  CONNECT_LINK_WINDOW_MS,
  hashToken,
  limitDecision,
  newConnectToken,
  startPayload,
} from '../domain/connect-link.js';
import type {
  BotReadiness,
  ConnectLinkRepo,
  MembershipLocks,
  TelegramLinkRepo,
  Transaction,
} from './ports.js';
import type { Settings, SettingsInput } from './settings.js';

export interface ConnectLinkIssuerDeps {
  transaction: Transaction;
  membership: MembershipLocks;
  links: Pick<TelegramLinkRepo, 'findLiveByAccount'>;
  connectLinks: ConnectLinkRepo;
  bots: BotReadiness;
  settings: Settings;
  clock: Clock;
  /** Entropy source (32 bytes for a token). */
  randomBytes: (size: number) => Uint8Array;
}

export interface ConnectLinkIssuer {
  createConnectLink(input: SettingsInput): Promise<IssuedConnectLink>;
}

/**
 * "Connect Telegram" (flow 8). One transaction. Lock order: the membership `FOR SHARE` first (the
 * order deactivation uses, so the two cannot deadlock), then the `connect-links:<ws>:<account>`
 * advisory lock. Checks in the contract's order: membership, limit, already linked, bot readiness.
 * A refusal throws, so the transaction rolls back and no row is made. Neither the token nor its hash
 * is logged.
 */
export function createConnectLinkIssuer(deps: ConnectLinkIssuerDeps): ConnectLinkIssuer {
  const { transaction, membership, links, connectLinks, bots, settings, clock, randomBytes } = deps;
  return {
    createConnectLink(input) {
      const { workspaceId, accountId } = input;
      return transaction(async (tx) => {
        const active = await membership.lockActiveMembers(tx, workspaceId, [accountId]);
        if (!active.includes(accountId)) {
          throw new AccessRemovedError('Your access to this workspace was removed');
        }
        await connectLinks.lockIssuing(workspaceId, accountId, tx);
        const now = clock.now();

        const { count, oldestCreatedAt } = await connectLinks.countSince(
          workspaceId,
          accountId,
          new Date(now.getTime() - CONNECT_LINK_WINDOW_MS),
          tx,
        );
        // The repo gives the count and the oldest time; under the lock at most 5 are inside the window.
        const decision = limitDecision(
          count >= CONNECT_LINK_LIMIT && oldestCreatedAt
            ? Array.from({ length: count }, () => oldestCreatedAt)
            : [],
          now,
        );
        if (!decision.allowed) {
          throw new ConnectLinkLimitReachedError(decision.retryAt, decision.retryAfterSeconds);
        }

        if (await links.findLiveByAccount(workspaceId, accountId, {}, tx)) {
          throw new TelegramAlreadyLinkedError(await settings.mySettings(input, tx));
        }
        const bot = await bots.pingReadiness(workspaceId, tx);
        if (!bot || bot.state !== 'connected') {
          throw new PingsNeedWorkingBotError(await settings.mySettings(input, tx));
        }

        const token = newConnectToken(randomBytes(32));
        const expiresAt = new Date(now.getTime() + CONNECT_LINK_TTL_MS);
        await connectLinks.markUnusedReplaced(workspaceId, accountId, now, tx);
        await connectLinks.insert(
          workspaceId,
          { id: newId(), accountId, tokenHash: hashToken(token), createdAt: now, expiresAt },
          tx,
        );
        return {
          workspace_id: workspaceId,
          bot_username: bot.username,
          url: `https://t.me/${bot.username}?start=${startPayload(token)}`,
          expires_at: expiresAt.toISOString(),
        };
      });
    },
  };
}
