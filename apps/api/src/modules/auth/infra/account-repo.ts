import type { Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Accounts } from '../../../platform/db.types.gen.js';
import { newId } from '../../../platform/ids.js';
import type { Account, AccountRepo } from '../app/ports.js';

function toAccount(row: Selectable<Accounts>): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export function createAccountRepo(db: Db): AccountRepo {
  return {
    async insert(input, tx) {
      const row = await (tx ?? db)
        .insertInto('accounts')
        .values({
          id: newId(),
          email: input.email,
          display_name: input.displayName,
          password_hash: input.passwordHash,
          created_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toAccount(row);
    },

    async findByEmail(email, tx) {
      const row = await (tx ?? db)
        .selectFrom('accounts')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst();
      return row && toAccount(row);
    },

    async findById(id, tx) {
      const row = await (tx ?? db)
        .selectFrom('accounts')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row && toAccount(row);
    },

    async findByIds(ids, tx) {
      if (ids.length === 0) return [];
      const rows = await (tx ?? db)
        .selectFrom('accounts')
        .selectAll()
        .where('id', 'in', [...ids])
        .execute();
      return rows.map(toAccount);
    },

    async updatePasswordHash(id, passwordHash, tx) {
      await (tx ?? db)
        .updateTable('accounts')
        .set({ password_hash: passwordHash })
        .where('id', '=', id)
        .execute();
    },
  };
}
