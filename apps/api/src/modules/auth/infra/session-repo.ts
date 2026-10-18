import type { Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Sessions } from '../../../platform/db.types.gen.js';
import { newId } from '../../../platform/ids.js';
import type { Session, SessionRepo } from '../app/ports.js';

function toSession(row: Selectable<Sessions>): Session {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createSessionRepo(db: Db): SessionRepo {
  return {
    async insert(input, tx) {
      const row = await (tx ?? db)
        .insertInto('sessions')
        .values({
          id: newId(),
          account_id: input.accountId,
          token_hash: input.tokenHash,
          created_at: input.now,
          last_seen_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toSession(row);
    },

    async findByTokenHash(tokenHash, tx) {
      const row = await (tx ?? db)
        .selectFrom('sessions')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row && toSession(row);
    },

    async findByIds(ids, tx) {
      if (ids.length === 0) return [];
      const rows = await (tx ?? db)
        .selectFrom('sessions')
        .selectAll()
        .where('id', 'in', ids)
        .execute();
      return rows.map(toSession);
    },

    async deleteByTokenHash(tokenHash, tx) {
      await (tx ?? db).deleteFrom('sessions').where('token_hash', '=', tokenHash).execute();
    },

    async deleteByAccount(accountId, options, tx) {
      let query = (tx ?? db).deleteFrom('sessions').where('account_id', '=', accountId);
      if (options?.exceptSessionId) query = query.where('id', '<>', options.exceptSessionId);
      const result = await query.executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async touch(sessionId, now, tx) {
      await (tx ?? db)
        .updateTable('sessions')
        .set({ last_seen_at: now })
        .where('id', '=', sessionId)
        .execute();
    },
  };
}
