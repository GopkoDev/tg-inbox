import type { Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { PasswordResetLinks } from '../../../platform/db.types.gen.js';
import { newId } from '../../../platform/ids.js';
import type { ResetLinkRecord, ResetLinkRepo } from '../app/ports.js';

function toRecord(row: Selectable<PasswordResetLinks>): ResetLinkRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    state: row.state as ResetLinkRecord['state'],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export function createResetLinkRepo(db: Db): ResetLinkRepo {
  return {
    async insert(input, tx) {
      const row = await (tx ?? db)
        .insertInto('password_reset_links')
        .values({
          id: newId(),
          account_id: input.accountId,
          token_hash: input.tokenHash,
          state: 'pending',
          expires_at: input.expiresAt,
          created_at: input.now,
          closed_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    },

    async supersedePending(accountId, now, tx) {
      await (tx ?? db)
        .updateTable('password_reset_links')
        .set({ state: 'superseded', closed_at: now })
        .where('account_id', '=', accountId)
        .where('state', '=', 'pending')
        .execute();
    },

    async findByTokenHash(tokenHash, tx) {
      const row = await (tx ?? db)
        .selectFrom('password_reset_links')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row && toRecord(row);
    },

    async consume(tokenHash, now, tx) {
      const row = await (tx ?? db)
        .updateTable('password_reset_links')
        .set({ state: 'used', closed_at: now })
        .where('token_hash', '=', tokenHash)
        .where('state', '=', 'pending')
        .where('expires_at', '>', now)
        .returningAll()
        .executeTakeFirst();
      return row && toRecord(row);
    },
  };
}
