import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Broadcasts } from '../../../platform/db.types.gen.js';
import type { TagMode } from '../domain/audience.js';
import type { BroadcastStatus } from '../domain/broadcast.js';
import type { AudienceKind, BroadcastRecord, BroadcastRepo, EndReason } from '../app/ports.js';

type BroadcastRow = Selectable<Broadcasts>;

/** How many launches the cap allows in 24 h; the 10th newest names the next free slot (AC-09). */
const LAUNCH_CAP = 10;

export function toBroadcast(r: BroadcastRow): BroadcastRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    text: r.text,
    status: r.status as BroadcastStatus,
    version: r.version,
    audienceKind: r.audience_kind as AudienceKind,
    tagMode: r.tag_mode as TagMode | null,
    authorAccountId: r.author_account_id,
    lastChangedByAccountId: r.last_changed_by_account_id,
    lastChangedAt: r.last_changed_at,
    createdAt: r.created_at,
    launchedAt: r.launched_at,
    launchedByAccountId: r.launched_by_account_id,
    launchTelegramBotId:
      r.launch_telegram_bot_id === null ? null : BigInt(r.launch_telegram_bot_id),
    audienceSize: r.audience_size,
    blockedCount: r.blocked_count,
    neverWroteCount: r.never_wrote_count,
    recipientCount: r.recipient_count,
    stoppedAt: r.stopped_at,
    stoppedByAccountId: r.stopped_by_account_id,
    endedAt: r.ended_at,
    endReason: r.end_reason as EndReason | null,
  };
}

export function createBroadcastRepo(db: Db): BroadcastRepo {
  const byKey = (ex: Db, workspaceId: string, id: string) =>
    ex
      .selectFrom('broadcasts')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id);

  return {
    async insertDraft(workspaceId, d, tx) {
      const row = await (tx ?? db)
        .insertInto('broadcasts')
        .values({
          id: d.id,
          workspace_id: workspaceId,
          name: d.name,
          text: d.text,
          status: 'draft',
          version: 1,
          audience_kind: d.audienceKind,
          tag_mode: d.tagMode,
          author_account_id: d.authorAccountId,
          last_changed_by_account_id: d.authorAccountId,
          last_changed_at: d.createdAt,
          created_at: d.createdAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toBroadcast(row);
    },

    async find(workspaceId, id, tx) {
      const row = await byKey(tx ?? db, workspaceId, id).executeTakeFirst();
      return row ? toBroadcast(row) : null;
    },

    async lockForUpdate(workspaceId, id, tx) {
      const row = await byKey(tx, workspaceId, id).forNoKeyUpdate().executeTakeFirst();
      return row ? toBroadcast(row) : null;
    },

    async saveFields(workspaceId, id, expectedVersion, fields, actorAccountId, at, tx) {
      const row = await (tx ?? db)
        .updateTable('broadcasts')
        .set((eb) => ({
          ...(fields.name !== undefined && { name: fields.name }),
          ...(fields.text !== undefined && { text: fields.text }),
          ...(fields.audienceKind !== undefined && { audience_kind: fields.audienceKind }),
          ...(fields.tagMode !== undefined && { tag_mode: fields.tagMode }),
          version: eb('version', '+', 1),
          last_changed_by_account_id: actorAccountId,
          last_changed_at: at,
        }))
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .where('version', '=', expectedVersion)
        .returningAll()
        .executeTakeFirst();
      return row ? toBroadcast(row) : null;
    },

    async touch(workspaceId, id, actorAccountId, at, tx) {
      const result = await (tx ?? db)
        .updateTable('broadcasts')
        .set({ last_changed_by_account_id: actorAccountId, last_changed_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async markStopped(workspaceId, id, actorAccountId, at, tx) {
      const result = await tx
        .updateTable('broadcasts')
        .set({
          status: 'stopped',
          stopped_at: at,
          stopped_by_account_id: actorAccountId,
          ended_at: at,
          end_reason: 'stopped',
          last_changed_by_account_id: actorAccountId,
          last_changed_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('status', '=', 'sending')
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async markSent(workspaceId, id, reason, at, tx) {
      const result = await tx
        .updateTable('broadcasts')
        .set({ status: 'sent', ended_at: at, end_reason: reason })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('status', '=', 'sending')
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async list(workspaceId) {
      const rows = await db
        .selectFrom('broadcasts')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .orderBy('last_changed_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map(toBroadcast);
    },

    async launchesSince(workspaceId, since, tx) {
      const { n } = await (tx ?? db)
        .selectFrom('broadcasts')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .where('launched_at', '>=', since)
        .executeTakeFirstOrThrow();
      return Number(n);
    },

    async tenthNewestLaunchedAt(workspaceId, tx) {
      const row = await (tx ?? db)
        .selectFrom('broadcasts')
        .select('launched_at')
        .where('workspace_id', '=', workspaceId)
        .where('launched_at', 'is not', null)
        .orderBy('launched_at', 'desc')
        .offset(LAUNCH_CAP - 1)
        .limit(1)
        .executeTakeFirst();
      return row?.launched_at ?? null;
    },

    async sendingBroadcasts(workspaceId, tx) {
      const rows = await (tx ?? db)
        .selectFrom('broadcasts')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('status', '=', 'sending')
        .orderBy('launched_at', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(toBroadcast);
    },

    async endedSince(workspaceId, since, tx) {
      const rows = await (tx ?? db)
        .selectFrom('broadcasts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('status', 'in', ['sent', 'stopped'])
        .where('ended_at', '>=', since)
        .execute();
      return rows.map((r) => r.id);
    },

    async lockLaunches(workspaceId, tx) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast-launches:${workspaceId}`}, 0))`.execute(
        tx,
      );
    },

    async markLaunched(workspaceId, id, l, tx) {
      const result = await tx
        .updateTable('broadcasts')
        .set({
          status: 'sending',
          text: l.text,
          launched_at: l.launchedAt,
          launched_by_account_id: l.launchedByAccountId,
          launch_telegram_bot_id: l.telegramBotId,
          audience_size: l.audienceSize,
          blocked_count: l.blockedCount,
          never_wrote_count: l.neverWroteCount,
          recipient_count: l.recipientCount,
          last_changed_by_account_id: l.launchedByAccountId,
          last_changed_at: l.launchedAt,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async deleteDraft(workspaceId, id, tx) {
      // No ON DELETE CASCADE: the draft's own rows go first, then the row (still a draft).
      const draft = await byKey(tx, workspaceId, id)
        .where('status', '=', 'draft')
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!draft) return false;
      await tx
        .deleteFrom('broadcast_audience_tags')
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', id)
        .execute();
      await tx
        .deleteFrom('broadcast_group_contacts')
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', id)
        .execute();
      const result = await tx
        .deleteFrom('broadcasts')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },
  };
}
