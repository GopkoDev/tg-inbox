import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import { hashCode } from '../domain/connect-code.js';
import { DESTINATION_LIMIT } from '../domain/limits.js';
import type { CodeRepo } from '../infra/code-repo.js';
import type {
  DestinationKind,
  DestinationRecord,
  DestinationRevival,
  NewDestination,
  DestinationProblem,
  DestinationRepo,
} from '../infra/destination-repo.js';
import { newId } from '../../../platform/ids.js';
import type { PostTransaction } from './drafts.js';
import type { DestinationSignals } from './destinations.js';

export interface ChatEventsDeps {
  transaction: PostTransaction;
  lockPosts(tx: Db, workspaceId: string): Promise<void>;
  codes: Pick<CodeRepo, 'findByHash' | 'markUsed' | 'markResult'>;
  destinations: Pick<
    DestinationRepo,
    'countLive' | 'findByChat' | 'lock' | 'setAvailability' | 'rename' | 'migrateChatId'
  > & {
    insert(
      workspaceId: string,
      d: Pick<NewDestination, keyof NewDestination>,
      tx?: Db,
    ): Promise<DestinationRecord>;
    revive(
      workspaceId: string,
      id: string,
      v: Pick<DestinationRevival, keyof DestinationRevival>,
      tx?: Db,
    ): Promise<DestinationRecord | null>;
  };
  bots: {
    postReadiness(workspaceId: string): Promise<{ state: string; telegramBotId: bigint } | null>;
    botRights(request: {
      workspaceId: string;
      telegramBotId: bigint;
      chatId: bigint;
      kind: string;
    }): Promise<{ canPost: boolean }>;
    deletePost(request: {
      workspaceId: string;
      telegramBotId: bigint;
      chatId: string;
      messageId: bigint;
    }): Promise<unknown>;
  };
  signals: Pick<DestinationSignals, 'destinationsChanged'>;
  clock: Clock;
}

interface Context {
  workspaceId: string;
  telegramBotId: bigint;
}

class Rollback extends Error {}

const kindOf = (telegramKind: string): DestinationKind =>
  telegramKind === 'channel' ? 'channel' : 'group';

export function createChatEvents(deps: ChatEventsDeps) {
  const { transaction, lockPosts, codes, destinations, bots, signals, clock } = deps;

  /** The destination this bot owns in that chat, live, locked; null for any other chat. */
  async function ownLive(tx: Db, e: Context & { chatId: bigint }) {
    const found = await destinations.findByChat(e.workspaceId, e.chatId, tx);
    if (!found || found.removedAt || found.telegramBotId !== e.telegramBotId) return null;
    return destinations.lock(e.workspaceId, found.id, tx);
  }

  return {
    async onDestinationCode(
      e: Context & {
        chatId: bigint;
        kind: string;
        title: string;
        username: string | null;
        messageId: bigint;
        code: string;
      },
    ): Promise<void> {
      const ready = await bots.postReadiness(e.workspaceId);
      if (!ready || ready.state !== 'connected' || ready.telegramBotId !== e.telegramBotId) return;
      const rights = await bots.botRights({
        workspaceId: e.workspaceId,
        telegramBotId: e.telegramBotId,
        chatId: e.chatId,
        kind: e.kind,
      });
      const now = clock.now();
      let connected = false;
      try {
        await transaction(async (tx) => {
          const code = await codes.findByHash(e.workspaceId, hashCode(e.code), tx);
          if (!code || code.usedAt || code.replacedAt || code.expiresAt <= now) return;
          if (!rights.canPost) {
            const result = kindOf(e.kind) === 'group' ? 'no_send_right' : 'no_post_right';
            await codes.markResult(e.workspaceId, code.id, result, now, tx);
            await signals.destinationsChanged(tx, e.workspaceId);
            return;
          }
          await lockPosts(tx, e.workspaceId);
          const existing = await destinations.findByChat(e.workspaceId, e.chatId, tx);
          const refuseAtLimit = async () => {
            await codes.markResult(e.workspaceId, code.id, 'destination_limit', now, tx);
            await signals.destinationsChanged(tx, e.workspaceId);
          };
          let id: string;
          if (existing) {
            await destinations.lock(e.workspaceId, existing.id, tx);
            if (
              existing.removedAt &&
              (await destinations.countLive(e.workspaceId, tx)) >= DESTINATION_LIMIT
            ) {
              await refuseAtLimit();
              return;
            }
            const revived = await destinations.revive(
              e.workspaceId,
              existing.id,
              {
                telegramBotId: e.telegramBotId,
                kind: kindOf(e.kind),
                title: e.title,
                username: e.username,
                availability: 'available',
                problem: null,
                membershipChangedAt: now,
                connectedByAccountId: code.accountId,
                connectedAt: now,
              },
              tx,
            );
            if (!revived) return;
            id = revived.id;
          } else {
            if ((await destinations.countLive(e.workspaceId, tx)) >= DESTINATION_LIMIT) {
              await refuseAtLimit();
              return;
            }
            const created = await destinations.insert(
              e.workspaceId,
              {
                id: newId(),
                telegramBotId: e.telegramBotId,
                chatId: e.chatId,
                kind: kindOf(e.kind),
                title: e.title,
                username: e.username,
                connectedByAccountId: code.accountId,
                connectedAt: now,
                membershipChangedAt: now,
              },
              tx,
            );
            id = created.id;
          }
          if (!(await codes.markUsed(e.workspaceId, code.id, id, now, tx))) throw new Rollback();
          await signals.destinationsChanged(tx, e.workspaceId);
          connected = true;
        });
      } catch (err) {
        if (err instanceof Rollback) return;
        throw err;
      }
      if (!connected) return;
      try {
        await bots.deletePost({
          workspaceId: e.workspaceId,
          telegramBotId: e.telegramBotId,
          chatId: e.chatId.toString(),
          messageId: e.messageId,
        });
      } catch {
        // Best effort: the code is already spent.
      }
    },

    async onChatMembership(
      e: Context & { chatId: bigint; status: string; canPost: boolean; date: Date },
    ): Promise<void> {
      await transaction(async (tx) => {
        const dest = await ownLive(tx, e);
        if (!dest) return;
        const gone = e.status === 'left' || e.status === 'kicked';
        const problem: DestinationProblem | null = gone
          ? 'not_member'
          : e.canPost
            ? null
            : 'no_post_right';
        const applied = await destinations.setAvailability(
          e.workspaceId,
          dest.id,
          {
            availability: problem ? 'unavailable' : 'available',
            problem,
            membershipChangedAt: e.date,
          },
          tx,
        );
        if (applied) await signals.destinationsChanged(tx, e.workspaceId);
      });
    },

    async onChatMigrated(e: Context & { chatId: bigint; newChatId: bigint }): Promise<void> {
      await transaction(async (tx) => {
        const dest = await ownLive(tx, e);
        if (!dest) return;
        await destinations.migrateChatId(e.workspaceId, dest.id, e.newChatId, tx);
        await signals.destinationsChanged(tx, e.workspaceId);
      });
    },

    async onChatRenamed(e: Context & { chatId: bigint; title: string }): Promise<void> {
      await transaction(async (tx) => {
        const dest = await ownLive(tx, e);
        if (!dest) return;
        await destinations.rename(
          e.workspaceId,
          dest.id,
          { title: e.title, username: dest.username },
          tx,
        );
        await signals.destinationsChanged(tx, e.workspaceId);
      });
    },
  };
}

export type ChatEvents = ReturnType<typeof createChatEvents>;
