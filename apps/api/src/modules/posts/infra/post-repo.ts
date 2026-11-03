import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Posts } from '../../../platform/db.types.gen.js';
import type { PostState } from '../domain/post.js';

export type ScheduleKind = 'now' | 'time';
export type DraftNotice = 'owner_deactivated' | 'owner_role_changed' | 'destination_removed';

export interface PostRecord {
  id: string;
  workspaceId: string;
  destinationId: string | null;
  text: string;
  silent: boolean;
  state: PostState;
  version: number;
  authorAccountId: string;
  lastChangedByAccountId: string;
  lastChangedAt: Date;
  createdAt: Date;
  scheduledFor: Date | null;
  scheduledByAccountId: string | null;
  scheduleKind: ScheduleKind | null;
  sendingStartedAt: Date | null;
  publishedAt: Date | null;
  telegramMessageId: bigint | null;
  outcomeReason: string | null;
  outcomeAt: Date | null;
  needsAttention: boolean;
  draftNotice: DraftNotice | null;
  deletedAt: Date | null;
  deletedByAccountId: string | null;
}

export interface NewPostDraft {
  id: string;
  destinationId: string | null;
  text: string;
  silent: boolean;
  authorAccountId: string;
  createdAt: Date;
}

export interface DraftPatch {
  text?: string;
  silent?: boolean;
  destinationId?: string | null;
}

export interface ScheduleInput {
  scheduledFor: Date;
  scheduledByAccountId: string;
  scheduleKind: ScheduleKind;
}

/** States whose claim counts toward the daily limit (matches `posts_sent_idx`). */
const SENT_STATES = ['sending', 'published', 'not_confirmed', 'deleted'];
const LIST_CAP = 200;

function toPost(r: Selectable<Posts>): PostRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    destinationId: r.destination_id,
    text: r.text,
    silent: r.silent,
    state: r.state as PostState,
    version: r.version,
    authorAccountId: r.author_account_id,
    lastChangedByAccountId: r.last_changed_by_account_id,
    lastChangedAt: r.last_changed_at,
    createdAt: r.created_at,
    scheduledFor: r.scheduled_for,
    scheduledByAccountId: r.scheduled_by_account_id,
    scheduleKind: r.schedule_kind as ScheduleKind | null,
    sendingStartedAt: r.sending_started_at,
    publishedAt: r.published_at,
    telegramMessageId: r.telegram_message_id === null ? null : BigInt(r.telegram_message_id),
    outcomeReason: r.outcome_reason,
    outcomeAt: r.outcome_at,
    needsAttention: r.needs_attention,
    draftNotice: r.draft_notice as DraftNotice | null,
    deletedAt: r.deleted_at,
    deletedByAccountId: r.deleted_by_account_id,
  };
}

/** The per-workspace posts lock (advisory `posts:<ws>`), held until `tx` ends. */
export async function lockPosts(tx: Db, workspaceId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`posts:${workspaceId}`}, 0))`.execute(
    tx,
  );
}

export function createPostRepo(db: Db) {
  const scoped = (ex: Db, workspaceId: string, id: string) =>
    ex.selectFrom('posts').selectAll().where('workspace_id', '=', workspaceId).where('id', '=', id);

  const count = async (q: { executeTakeFirstOrThrow(): Promise<{ n: string }> }): Promise<number> =>
    Number((await q.executeTakeFirstOrThrow()).n);

  return {
    async insertDraft(workspaceId: string, d: NewPostDraft, tx?: Db): Promise<PostRecord> {
      const row = await (tx ?? db)
        .insertInto('posts')
        .values({
          id: d.id,
          workspace_id: workspaceId,
          destination_id: d.destinationId,
          text: d.text,
          silent: d.silent,
          state: 'draft',
          version: 1,
          author_account_id: d.authorAccountId,
          last_changed_by_account_id: d.authorAccountId,
          last_changed_at: d.createdAt,
          created_at: d.createdAt,
          needs_attention: false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toPost(row);
    },

    async find(workspaceId: string, id: string, tx?: Db): Promise<PostRecord | null> {
      const row = await scoped(tx ?? db, workspaceId, id).executeTakeFirst();
      return row ? toPost(row) : null;
    },

    async lock(workspaceId: string, id: string, tx: Db): Promise<PostRecord | null> {
      const row = await scoped(tx, workspaceId, id).forNoKeyUpdate().executeTakeFirst();
      return row ? toPost(row) : null;
    },

    /** Saves a draft at the expected version (raises it); null when stale, not a draft or foreign. */
    async saveDraft(
      workspaceId: string,
      id: string,
      expectedVersion: number,
      patch: DraftPatch,
      byAccountId: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.silent !== undefined ? { silent: patch.silent } : {}),
          ...(patch.destinationId !== undefined ? { destination_id: patch.destinationId } : {}),
          version: expectedVersion + 1,
          last_changed_by_account_id: byAccountId,
          last_changed_at: at,
          draft_notice: null,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'draft')
        .where('version', '=', expectedVersion)
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    async schedule(
      workspaceId: string,
      id: string,
      expectedVersion: number,
      s: ScheduleInput,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          state: 'scheduled',
          scheduled_for: s.scheduledFor,
          scheduled_by_account_id: s.scheduledByAccountId,
          schedule_kind: s.scheduleKind,
          last_changed_by_account_id: s.scheduledByAccountId,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', 'in', ['draft', 'scheduled'])
        .where('version', '=', expectedVersion)
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    /** Commits the claim before the send: scheduled -> sending, once. */
    async claim(workspaceId: string, id: string, at: Date, tx?: Db): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({ state: 'sending', sending_started_at: at, last_changed_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'scheduled')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    async markPublished(
      workspaceId: string,
      id: string,
      v: { telegramMessageId: bigint },
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          state: 'published',
          telegram_message_id: v.telegramMessageId.toString(),
          published_at: at,
          outcome_at: at,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'sending')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    async markMissed(
      workspaceId: string,
      id: string,
      reason: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          state: 'missed',
          outcome_reason: reason,
          outcome_at: at,
          needs_attention: true,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'scheduled')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    /** Scheduled or sending -> failed with a reason; never tried again, needs attention. */
    async markFailed(
      workspaceId: string,
      id: string,
      reason: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          state: 'failed',
          outcome_reason: reason,
          outcome_at: at,
          needs_attention: true,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', 'in', ['scheduled', 'sending'])
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    /** Sending -> not confirmed: a claim that got no answer; never sent again. */
    async markNotConfirmed(
      workspaceId: string,
      id: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({ state: 'not_confirmed', outcome_at: at, needs_attention: true, last_changed_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'sending')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    /** Sending -> scheduled again (a 429 or a send pause: nothing reached the chat). */
    async returnToScheduled(
      workspaceId: string,
      id: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({ state: 'scheduled', sending_started_at: null, last_changed_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'sending')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    async clearAttention(workspaceId: string, id: string, tx?: Db): Promise<boolean> {
      const res = await (tx ?? db)
        .updateTable('posts')
        .set({ needs_attention: false })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('needs_attention', '=', true)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },

    async countAttention(workspaceId: string, tx?: Db): Promise<number> {
      return count(
        (tx ?? db)
          .selectFrom('posts')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', workspaceId)
          .where('needs_attention', '=', true),
      );
    },

    /** Published -> deleted by a member; the text stays. */
    async markDeleted(
      workspaceId: string,
      id: string,
      byAccountId: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          state: 'deleted',
          deleted_at: at,
          deleted_by_account_id: byAccountId,
          last_changed_by_account_id: byAccountId,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'published')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    /** Scheduled -> draft with a notice, raising the version so stale confirmations fail. */
    async returnToDraft(
      workspaceId: string,
      id: string,
      notice: DraftNotice | null,
      byAccountId: string,
      at: Date,
      tx?: Db,
    ): Promise<PostRecord | null> {
      const row = await (tx ?? db)
        .updateTable('posts')
        .set({
          state: 'draft',
          version: sql`version + 1`,
          draft_notice: notice,
          scheduled_for: null,
          scheduled_by_account_id: null,
          schedule_kind: null,
          last_changed_by_account_id: byAccountId,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'scheduled')
        .returningAll()
        .executeTakeFirst();
      return row ? toPost(row) : null;
    },

    async list(workspaceId: string, filter: { state?: PostState }, tx?: Db): Promise<PostRecord[]> {
      let q = (tx ?? db).selectFrom('posts').selectAll().where('workspace_id', '=', workspaceId);
      if (filter.state) q = q.where('state', '=', filter.state);
      const rows = await q
        .orderBy('last_changed_at', 'desc')
        .orderBy('id', 'desc')
        .limit(LIST_CAP)
        .execute();
      return rows.map(toPost);
    },

    /** Deletes a draft (the only state a post may be removed in); false when not a draft or foreign. */
    async remove(workspaceId: string, id: string, tx?: Db): Promise<boolean> {
      const res = await (tx ?? db)
        .deleteFrom('posts')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'draft')
        .executeTakeFirst();
      return Number(res.numDeletedRows) > 0;
    },

    async countScheduled(workspaceId: string, tx?: Db): Promise<number> {
      return count(
        (tx ?? db)
          .selectFrom('posts')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', workspaceId)
          .where('state', '=', 'scheduled'),
      );
    },

    /** Posts handed to Telegram at or after `since` (the daily limit). */
    async countSentSince(workspaceId: string, since: Date, tx?: Db): Promise<number> {
      return count(
        (tx ?? db)
          .selectFrom('posts')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('workspace_id', '=', workspaceId)
          .where('state', 'in', SENT_STATES)
          .where('sending_started_at', '>=', since),
      );
    },

    /** When each post handed to Telegram at or after `since` was claimed (the daily limit's window). */
    async sentTimesSince(workspaceId: string, since: Date, tx?: Db): Promise<Date[]> {
      const rows = await (tx ?? db)
        .selectFrom('posts')
        .select('sending_started_at')
        .where('workspace_id', '=', workspaceId)
        .where('state', 'in', SENT_STATES)
        .where('sending_started_at', '>=', since)
        .execute();
      return rows.map((r) => r.sending_started_at!);
    },

    async scheduledByAccount(
      workspaceId: string,
      accountId: string,
      tx?: Db,
    ): Promise<PostRecord[]> {
      const rows = await (tx ?? db)
        .selectFrom('posts')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('state', '=', 'scheduled')
        .where('scheduled_by_account_id', '=', accountId)
        .orderBy('scheduled_for')
        .orderBy('id')
        .execute();
      return rows.map(toPost);
    },

    /** Posts of one chat ahead of (`before`, `excludeId`) by (scheduled_for, id), plus any `sending` post (per-chat order). */
    async earlierDueInChat(
      workspaceId: string,
      destinationId: string,
      before: Date,
      excludeId: string,
      tx?: Db,
    ): Promise<PostRecord[]> {
      const rows = await (tx ?? db)
        .selectFrom('posts')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('destination_id', '=', destinationId)
        .where('id', '<>', excludeId)
        .where((eb) =>
          eb.or([
            eb('state', '=', 'sending'),
            eb.and([
              eb('state', '=', 'scheduled'),
              eb.or([
                eb('scheduled_for', '<', before),
                eb.and([eb('scheduled_for', '=', before), eb('id', '<', excludeId)]),
              ]),
            ]),
          ]),
        )
        .orderBy('scheduled_for')
        .orderBy('id')
        .execute();
      return rows.map(toPost);
    },
  };
}

export type PostRepo = ReturnType<typeof createPostRepo>;
