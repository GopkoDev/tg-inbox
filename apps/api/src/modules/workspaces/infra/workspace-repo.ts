import type { Kysely } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import type { WorkspaceRecord, WorkspaceRepo } from '../app/ports.js';

export class KyselyWorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async insert(w: WorkspaceRecord): Promise<void> {
    await this.db
      .insertInto('workspaces')
      .values({ id: w.id, name: w.name, created_at: w.createdAt })
      .execute();
  }

  async findById(workspaceId: string): Promise<WorkspaceRecord | null> {
    const row = await this.db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', workspaceId)
      .executeTakeFirst();
    return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
  }

  /**
   * Serialises the writers that lock the workspace first. `FOR NO KEY UPDATE`, not `FOR UPDATE`: the
   * foreign-key check of any insert that names the workspace (an activity entry, a message) takes
   * `FOR KEY SHARE`, which `FOR UPDATE` would block — and a member change that holds its membership
   * `FOR SHARE` while it inserts would then deadlock with a deactivation (sad.md §8).
   */
  async lockForUpdate(workspaceId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspaceId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    return row !== undefined;
  }

  async getTimeZone(workspaceId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('workspaces')
      .select('time_zone')
      .where('id', '=', workspaceId)
      .executeTakeFirst();
    return row?.time_zone ?? null;
  }

  /** Writes only when the zone differs (a same-zone call is not an UPDATE). */
  async setTimeZone(workspaceId: string, zone: string): Promise<void> {
    await this.db
      .updateTable('workspaces')
      .set({ time_zone: zone })
      .where('id', '=', workspaceId)
      .where((eb) => eb.or([eb('time_zone', 'is', null), eb('time_zone', '!=', zone)]))
      .execute();
  }
}
