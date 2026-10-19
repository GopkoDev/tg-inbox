import type { Clock } from '../../../platform/clock.js';
import { answerText } from '../domain/answers.js';
import type {
  BotMessage,
  BotReadiness,
  SendMemberMessage,
  TelegramLinkRepo,
  WorkspaceNames,
} from './ports.js';

export interface DeliverAnswerDeps {
  links: Pick<TelegramLinkRepo, 'findById' | 'clearRemovedUserId'>;
  bots: Pick<BotReadiness, 'pingReadiness'>;
  workspaces: WorkspaceNames;
  send: SendMemberMessage;
  /** The panel's base address (`PUBLIC_WEB_URL`). */
  panelUrl: string;
  clock: Clock;
}

export type DeliverResult =
  /** Finished: sent, or nothing to send, or nothing to retry. */
  | { result: 'done' }
  /** Telegram's limit: send again at `at` as a new delayed job (never a pg-boss retry). */
  | { result: 'retry_at'; at: Date }
  /** A timeout or network failure: fail the attempt so pg-boss retries. */
  | { result: 'failed' };

export interface DeliverAnswer {
  /**
   * One `notifications.send-bot-message` job (flow 10). Reads nothing the job did not name: the
   * recipient comes from the link row (or the payload's Telegram user id for the two answers that
   * have no link). `lastAttempt`: pg-boss will not retry after this run.
   * For `notifications_off` every finish - sent, blocked, bot not working, the last failed attempt -
   * clears the removed link's Telegram user id. Never logs or returns the text or the id.
   */
  deliver(
    workspaceId: string,
    message: BotMessage,
    options?: { lastAttempt?: boolean },
  ): Promise<DeliverResult>;
  /** The job is dead-lettered (retries used up or expired): the removed link's id is cleared anyway. */
  clearOnDeadLetter(workspaceId: string, message: BotMessage): Promise<void>;
}

export function createDeliverAnswer(deps: DeliverAnswerDeps): DeliverAnswer {
  const { links, bots, workspaces, send, panelUrl, clock } = deps;

  async function clearId(workspaceId: string, message: BotMessage): Promise<void> {
    if (message.kind === 'notifications_off') {
      await links.clearRemovedUserId(workspaceId, message.telegramLinkId);
    }
  }

  return {
    async deliver(workspaceId, message, options = {}) {
      const finish = async (): Promise<DeliverResult> => {
        await clearId(workspaceId, message);
        return { result: 'done' };
      };

      const bot = await bots.pingReadiness(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) return finish();
      if (bot.sendPausedUntil && bot.sendPausedUntil.getTime() > clock.now().getTime()) {
        return { result: 'retry_at', at: bot.sendPausedUntil };
      }

      let telegramUserId: bigint;
      if ('telegramLinkId' in message) {
        const link = await links.findById(workspaceId, message.telegramLinkId);
        // Only the "off" answer goes to a removed link; every other answer is moot once it is gone.
        const wanted = message.kind === 'notifications_off' ? link : link?.removedAt ? null : link;
        if (!wanted || wanted.telegramUserId === null) return finish();
        telegramUserId = wanted.telegramUserId;
      } else {
        telegramUserId = message.telegramUserId;
      }

      const name =
        message.kind === 'link_expired' ? '' : await workspaces.workspaceName(workspaceId);
      if (name === null) return finish();
      const text = answerText(message.kind, {
        workspaceName: name,
        workspaceId,
        panelUrl,
        ...(message.kind === 'cannot_connect' && { reason: message.reason }),
      });

      const sent = await send({ workspaceId, telegramUserId, text });
      switch (sent.outcome) {
        case 'rate_limited':
          return { result: 'retry_at', at: sent.retryAfter };
        case 'transient':
          if (options.lastAttempt) await clearId(workspaceId, message);
          return { result: 'failed' };
        case 'accepted':
        case 'blocked':
        case 'bot_unavailable':
          return finish();
      }
    },

    clearOnDeadLetter: (workspaceId, message) => clearId(workspaceId, message),
  };
}
