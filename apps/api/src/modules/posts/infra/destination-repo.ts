import type { Selectable, Updateable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Destinations } from '../../../platform/db.types.gen.js';

export type DestinationKind = 'channel' | 'group';
export type DestinationAvailability = 'available' | 'unavailable';
export type DestinationProblem = 'no_post_right' | 'not_member' | 'chat_gone';

export interface DestinationRecord {
  id: string;
  workspaceId: string;
  telegramBotId: bigint;
  chatId: bigint;
  kind: DestinationKind;
  title: string;
  username: string | null;
  availability: DestinationAvailability;
  problem: DestinationProblem | null;
  membershipChangedAt: Date;
  connectedByAccountId: string;
  connectedAt: Date;
  removedAt: Date | null;
  removedByAccountId: string | null;
  pausedUntil: Date | null;
  nextSendAt: Date | null;
}

export interface NewDestination {
  id: string;
  telegramBotId: bigint;
  chatId: bigint;
  kind: DestinationKind;
  title: string;
  username: string | null;
  connectedByAccountId: string;
  connectedAt: Date;
  membershipChangedAt: Date;
}

export interface DestinationRevival {
  telegramBotId: bigint;
  kind: DestinationKind;
  title: string;
  username: string | null;
  availability: DestinationAvailability;
  problem: DestinationProblem | null;
  membershipChangedAt: Date;
  connectedByAccountId: string;
  connectedAt: Date;
}

export function toDestination(r: Selectable<Destinations>): DestinationRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    telegramBotId: BigInt(r.telegram_bot_id),
    chatId: BigInt(r.chat_id),
    kind: r.kind as DestinationKind,
    title: r.title,
    username: r.username,
    availability: r.availability as DestinationAvailability,
    problem: r.problem as DestinationProblem | null,
    membershipChangedAt: r.membership_changed_at,
    connectedByAccountId: r.connected_by_account_id,
    connectedAt: r.connected_at,
    removedAt: r.removed_at,
    removedByAccountId: r.removed_by_account_id,
    pausedUntil: r.paused_until,
    nextSendAt: r.next_send_at,
  };
}

export function createDestinationRepo(db: Db) {
  const scoped = (ex: Db, workspaceId: string, id: string) =>
    ex
      .selectFrom('destinations')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id);

  const update = async (
    workspaceId: string,
    id: string,
    set: Updateable<Destinations>,
    tx?: Db,
  ): Promise<boolean> => {
    const res = await (tx ?? db)
      .updateTable('destinations')
      .set(set)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  };

  return {
    async insert(workspaceId: string, d: NewDestination, tx?: Db): Promise<DestinationRecord> {
      const row = await (tx ?? db)
        .insertInto('destinations')
        .values({
          id: d.id,
          workspace_id: workspaceId,
          telegram_bot_id: d.telegramBotId.toString(),
          chat_id: d.chatId.toString(),
          kind: d.kind,
          title: d.title,
          username: d.username,
          availability: 'available',
          problem: null,
          membership_changed_at: d.membershipChangedAt,
          connected_by_account_id: d.connectedByAccountId,
          connected_at: d.connectedAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toDestination(row);
    },

    async find(workspaceId: string, id: string, tx?: Db): Promise<DestinationRecord | null> {
      const row = await scoped(tx ?? db, workspaceId, id).executeTakeFirst();
      return row ? toDestination(row) : null;
    },

    async findByChat(
      workspaceId: string,
      chatId: bigint,
      tx?: Db,
    ): Promise<DestinationRecord | null> {
      const row = await (tx ?? db)
        .selectFrom('destinations')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('chat_id', '=', chatId.toString())
        .executeTakeFirst();
      return row ? toDestination(row) : null;
    },

    async listLive(workspaceId: string, tx?: Db): Promise<DestinationRecord[]> {
      const rows = await (tx ?? db)
        .selectFrom('destinations')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('removed_at', 'is', null)
        .orderBy('connected_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map(toDestination);
    },

    async countLive(workspaceId: string, tx?: Db): Promise<number> {
      const row = await (tx ?? db)
        .selectFrom('destinations')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .where('removed_at', 'is', null)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async lock(workspaceId: string, id: string, tx: Db): Promise<DestinationRecord | null> {
      const row = await scoped(tx, workspaceId, id).forNoKeyUpdate().executeTakeFirst();
      return row ? toDestination(row) : null;
    },

    /** Applies a membership fact unless a newer one is already recorded. */
    async setAvailability(
      workspaceId: string,
      id: string,
      v: {
        availability: DestinationAvailability;
        problem: DestinationProblem | null;
        membershipChangedAt: Date;
      },
      tx?: Db,
    ): Promise<boolean> {
      const res = await (tx ?? db)
        .updateTable('destinations')
        .set({
          availability: v.availability,
          problem: v.problem,
          membership_changed_at: v.membershipChangedAt,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('membership_changed_at', '<=', v.membershipChangedAt)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },

    rename(
      workspaceId: string,
      id: string,
      v: { title: string; username: string | null },
      tx?: Db,
    ): Promise<boolean> {
      return update(workspaceId, id, { title: v.title, username: v.username }, tx);
    },

    migrateChatId(workspaceId: string, id: string, chatId: bigint, tx?: Db): Promise<boolean> {
      return update(workspaceId, id, { chat_id: chatId.toString() }, tx);
    },

    setPausedUntil(workspaceId: string, id: string, until: Date | null, tx?: Db): Promise<boolean> {
      return update(workspaceId, id, { paused_until: until }, tx);
    },

    setNextSendAt(workspaceId: string, id: string, at: Date | null, tx?: Db): Promise<boolean> {
      return update(workspaceId, id, { next_send_at: at }, tx);
    },

    async remove(
      workspaceId: string,
      id: string,
      byAccountId: string,
      at: Date,
      tx?: Db,
    ): Promise<boolean> {
      const res = await (tx ?? db)
        .updateTable('destinations')
        .set({ removed_at: at, removed_by_account_id: byAccountId })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },

    async revive(
      workspaceId: string,
      id: string,
      v: DestinationRevival,
      tx?: Db,
    ): Promise<DestinationRecord | null> {
      const row = await (tx ?? db)
        .updateTable('destinations')
        .set({
          removed_at: null,
          removed_by_account_id: null,
          telegram_bot_id: v.telegramBotId.toString(),
          kind: v.kind,
          title: v.title,
          username: v.username,
          availability: v.availability,
          problem: v.problem,
          membership_changed_at: v.membershipChangedAt,
          connected_by_account_id: v.connectedByAccountId,
          connected_at: v.connectedAt,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return row ? toDestination(row) : null;
    },
  };
}

export type DestinationRepo = ReturnType<typeof createDestinationRepo>;
