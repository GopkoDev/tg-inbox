import type { Db } from '../../../platform/db.js';
import { sql } from 'kysely';
import type { PresenceLease } from '../domain/presence.js';
import type { PresenceRepo } from '../app/ports.js';

export function createPresenceRepo(db: Db): PresenceRepo {
  return {
    async open(workspaceId, lease, tx) {
      await (tx ?? db)
        .insertInto('tab_presences')
        .values({
          id: lease.id,
          workspace_id: workspaceId,
          account_id: lease.accountId,
          live_until: lease.liveUntil,
          on_screen: lease.onScreen,
          last_on_screen_at: lease.onScreen ? lease.at : null,
          opened_at: lease.at,
        })
        .execute();
    },

    async extend(workspaceId, id, liveUntil, tx) {
      const row = await (tx ?? db)
        .updateTable('tab_presences')
        .set({ live_until: sql`GREATEST(live_until, ${liveUntil}::timestamptz)` })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async setScreen(workspaceId, id, onScreen, at, hiddenSince, tx) {
      const row = await (tx ?? db)
        .updateTable('tab_presences')
        .set({
          on_screen: onScreen,
          // Stamped while on screen and on a real on -> off transition only: an off frame on a tab
          // that was never on screen keeps NULL (away), a repeated off keeps the time it left (D1).
          // A lease with no on-screen history (a hidden tab that reconnected) takes the time the tab
          // says it left, already bounded by the caller.
          last_on_screen_at: sql`CASE WHEN ${onScreen}::boolean OR on_screen
            THEN GREATEST(last_on_screen_at, ${at}::timestamptz)
            ELSE COALESCE(last_on_screen_at, ${hiddenSince ?? null}::timestamptz) END`,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async close(workspaceId, id, tx) {
      const row = await (tx ?? db)
        .deleteFrom('tab_presences')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async deleteExpired(workspaceId, now, accountId, tx) {
      const rows = await (tx ?? db)
        .deleteFrom('tab_presences')
        .where('workspace_id', '=', workspaceId)
        .where('live_until', '<=', now)
        .$if(accountId !== undefined, (qb) => qb.where('account_id', '=', accountId as string))
        .returning('id')
        .execute();
      return rows.length;
    },

    async listLive(workspaceId, now, accountIds, tx) {
      const byMember = new Map<string, PresenceLease[]>();
      if (accountIds?.length === 0) return byMember;
      const rows = await (tx ?? db)
        .selectFrom('tab_presences')
        .select(['account_id', 'live_until', 'on_screen', 'last_on_screen_at'])
        .where('workspace_id', '=', workspaceId)
        .where('live_until', '>', now)
        .$if(accountIds !== undefined, (qb) => qb.where('account_id', 'in', accountIds as string[]))
        .orderBy('opened_at')
        .orderBy('id')
        .execute();
      for (const r of rows) {
        const list = byMember.get(r.account_id) ?? [];
        list.push({
          liveUntil: r.live_until,
          onScreen: r.on_screen,
          lastOnScreenAt: r.last_on_screen_at,
        });
        byMember.set(r.account_id, list);
      }
      return byMember;
    },
  };
}
