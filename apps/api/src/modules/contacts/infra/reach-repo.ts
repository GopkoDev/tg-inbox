import type { Db } from '../../../platform/db.js';
import type { Executor, ReachRepo } from '../app/ports.js';

interface ReachRow {
  wrote_at: Date | null;
  blocked_at: Date | null;
  changed_at: Date;
}

/**
 * `contact_bot_reach` writes (ADR-0002). Each write locks only its reach row: the row `FOR UPDATE`
 * when it exists, else an insert that yields to a concurrent one (`ON CONFLICT DO NOTHING`) and
 * then reads the winner's row under the lock — so two facts for one row are applied one after the
 * other and only one of them reports the change.
 */
export function createReachRepo(db: Db): ReachRepo {
  const key = (ex: Executor, workspaceId: string, contactId: string, telegramBotId: bigint) =>
    ex
      .selectFrom('contact_bot_reach')
      .where('workspace_id', '=', workspaceId)
      .where('contact_id', '=', contactId)
      .where('telegram_bot_id', '=', String(telegramBotId));

  /** The locked row, or null after inserting `fresh` (nobody else had the row). */
  async function lockOrInsert(
    ex: Executor,
    workspaceId: string,
    contactId: string,
    telegramBotId: bigint,
    fresh: ReachRow,
  ): Promise<ReachRow | null> {
    const lock = () =>
      key(ex, workspaceId, contactId, telegramBotId)
        .select(['wrote_at', 'blocked_at', 'changed_at'])
        .forUpdate()
        .executeTakeFirst();
    const existing = await lock();
    if (existing) return existing;
    const inserted = await ex
      .insertInto('contact_bot_reach')
      .values({
        workspace_id: workspaceId,
        contact_id: contactId,
        telegram_bot_id: telegramBotId,
        ...fresh,
      })
      .onConflict((oc) => oc.columns(['workspace_id', 'contact_id', 'telegram_bot_id']).doNothing())
      .returning('changed_at')
      .executeTakeFirst();
    if (inserted) return null;
    // A concurrent insert won; its row is committed (the conflict waited for it).
    const winner = await lock();
    if (!winner) throw new Error('contact_bot_reach row vanished after a conflict');
    return winner;
  }

  const update = (
    ex: Executor,
    workspaceId: string,
    contactId: string,
    telegramBotId: bigint,
    next: ReachRow,
  ) =>
    ex
      .updateTable('contact_bot_reach')
      .set(next)
      .where('workspace_id', '=', workspaceId)
      .where('contact_id', '=', contactId)
      .where('telegram_bot_id', '=', String(telegramBotId))
      .execute();

  return {
    async upsertWrote(workspaceId, contactId, telegramBotId, sentAt, tx) {
      const ex = tx ?? db;
      const row = await lockOrInsert(ex, workspaceId, contactId, telegramBotId, {
        wrote_at: sentAt,
        blocked_at: null,
        changed_at: sentAt,
      });
      if (row === null) return false;
      const newer = sentAt.getTime() >= row.changed_at.getTime();
      const wroteAt =
        row.wrote_at === null || sentAt.getTime() < row.wrote_at.getTime() ? sentAt : row.wrote_at;
      const next: ReachRow = newer
        ? { wrote_at: wroteAt, blocked_at: null, changed_at: sentAt }
        : { ...row, wrote_at: wroteAt };
      if (
        next.wrote_at !== row.wrote_at ||
        next.blocked_at !== row.blocked_at ||
        next.changed_at !== row.changed_at
      ) {
        await update(ex, workspaceId, contactId, telegramBotId, next);
      }
      return newer && row.blocked_at !== null;
    },

    async applyBlockChange(workspaceId, contactId, telegramBotId, blocked, at, tx) {
      const ex = tx ?? db;
      const row = await lockOrInsert(ex, workspaceId, contactId, telegramBotId, {
        wrote_at: null,
        blocked_at: blocked ? at : null,
        changed_at: at,
      });
      // A fresh row: only a block is a visible change (no row reads as "not blocked").
      if (row === null) return blocked;
      if (at.getTime() < row.changed_at.getTime()) return false;
      const wasBlocked = row.blocked_at !== null;
      await update(ex, workspaceId, contactId, telegramBotId, {
        wrote_at: row.wrote_at,
        blocked_at: blocked ? (row.blocked_at ?? at) : null,
        changed_at: at,
      });
      return wasBlocked !== blocked;
    },
  };
}
