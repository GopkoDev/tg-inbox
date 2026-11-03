import type { Kysely } from 'kysely';
import { isValidTimeZone } from '@tg/shared';
import { TimeZoneInvalidError } from '../../../platform/errors.js';
import type { DB } from '../../../platform/db.types.gen.js';
import { KyselyWorkspaceRepo } from '../infra/workspace-repo.js';

/** The workspace's IANA time zone: read, and set inside the caller's transaction (no route here). */
export function createWorkspaceTimeZone(deps: { db: Kysely<DB> }) {
  return {
    timeZone(workspaceId: string): Promise<string | null> {
      return new KyselyWorkspaceRepo(deps.db).getTimeZone(workspaceId);
    },
    async setTimeZone(tx: Kysely<DB>, workspaceId: string, zone: string): Promise<void> {
      if (!isValidTimeZone(zone)) throw new TimeZoneInvalidError();
      await new KyselyWorkspaceRepo(tx).setTimeZone(workspaceId, zone);
    },
  };
}

export type WorkspaceTimeZone = ReturnType<typeof createWorkspaceTimeZone>;
