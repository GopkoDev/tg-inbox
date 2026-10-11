import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import type { SignInFailureRepo } from '../app/ports.js';

const RECENT_WINDOW_MS = 30 * 60_000;

export function createSignInFailureRepo(db: Db): SignInFailureRepo {
  return {
    async record(email, now, tx) {
      await (tx ?? db)
        .insertInto('sign_in_failures')
        .values({ id: newId(), email, failed_at: now })
        .execute();
    },

    async listRecent(email, now, tx) {
      const rows = await (tx ?? db)
        .selectFrom('sign_in_failures')
        .select('failed_at')
        .where('email', '=', email)
        .where('failed_at', '>', new Date(now.getTime() - RECENT_WINDOW_MS))
        .orderBy('failed_at', 'asc')
        .execute();
      return rows.map((r) => r.failed_at);
    },

    async clear(email, tx) {
      await (tx ?? db).deleteFrom('sign_in_failures').where('email', '=', email).execute();
    },
  };
}
