import type { Kysely, Selectable } from 'kysely';
import type { DB, Memberships } from '../../../platform/db.types.gen.js';
import type { MembershipState, Role } from '../domain/membership.js';
import type {
  ActiveMembershipOfAccount,
  MembershipRecord,
  MembershipRepo,
  PageQuery,
} from '../app/ports.js';

function toRecord(row: Selectable<Memberships>): MembershipRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    role: row.role as Role,
    state: row.state as MembershipState,
    lastUsedAt: row.last_used_at,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    activeSince: row.active_since,
  };
}

export class KyselyMembershipRepo implements MembershipRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async insert(workspaceId: string, m: Omit<MembershipRecord, 'workspaceId'>): Promise<void> {
    await this.db
      .insertInto('memberships')
      .values({
        id: m.id,
        workspace_id: workspaceId,
        account_id: m.accountId,
        role: m.role,
        state: m.state,
        last_used_at: m.lastUsedAt,
        deactivated_at: m.deactivatedAt,
        created_at: m.createdAt,
        active_since: m.activeSince,
      })
      .execute();
  }

  async findById(workspaceId: string, membershipId: string): Promise<MembershipRecord | null> {
    const row = await this.db
      .selectFrom('memberships')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', membershipId)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async findByAccount(workspaceId: string, accountId: string): Promise<MembershipRecord | null> {
    const row = await this.db
      .selectFrom('memberships')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async list(workspaceId: string, page: PageQuery): Promise<MembershipRecord[]> {
    let q = this.db.selectFrom('memberships').selectAll().where('workspace_id', '=', workspaceId);
    if (page.after) q = q.where('id', '>', page.after);
    if (page.before) {
      const rows = await q
        .where('id', '<', page.before)
        .orderBy('id', 'desc')
        .limit(page.limit)
        .execute();
      return rows.reverse().map(toRecord);
    }
    const rows = await q.orderBy('id', 'asc').limit(page.limit).execute();
    return rows.map(toRecord);
  }

  async countActiveOwners(workspaceId: string): Promise<number> {
    const row = await this.db
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('workspace_id', '=', workspaceId)
      .where('role', '=', 'owner')
      .where('state', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async hasAnyMember(workspaceId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async setState(
    workspaceId: string,
    membershipId: string,
    state: MembershipState,
    deactivatedAt: Date | null,
    activeSince?: Date,
  ): Promise<boolean> {
    const res = await this.db
      .updateTable('memberships')
      .set({
        state,
        deactivated_at: deactivatedAt,
        ...(activeSince ? { active_since: activeSince } : {}),
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', membershipId)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async accountIdsAmong(workspaceId: string, accountIds: readonly string[]): Promise<string[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('memberships')
      .select('account_id')
      .where('workspace_id', '=', workspaceId)
      .where('account_id', 'in', [...accountIds])
      .execute();
    return rows.map((r) => r.account_id);
  }

  async activeAccountIdsAmong(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<string[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('memberships')
      .select('account_id')
      .where('workspace_id', '=', workspaceId)
      .where('state', '=', 'active')
      .where('account_id', 'in', [...accountIds])
      .execute();
    return rows.map((r) => r.account_id);
  }

  async lockActiveAccountIds(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<string[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('memberships')
      .select(['account_id', 'state'])
      .where('workspace_id', '=', workspaceId)
      .where('account_id', 'in', [...accountIds])
      .forShare()
      .execute();
    return rows.filter((r) => r.state === 'active').map((r) => r.account_id);
  }

  async listActiveAccountIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('memberships')
      .select('account_id')
      .where('workspace_id', '=', workspaceId)
      .where('state', '=', 'active')
      .execute();
    return rows.map((r) => r.account_id);
  }

  async touchLastUsed(workspaceId: string, accountId: string, at: Date): Promise<boolean> {
    const res = await this.db
      .updateTable('memberships')
      .set({ last_used_at: at })
      .where('workspace_id', '=', workspaceId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async listActiveOfAccount(accountId: string): Promise<ActiveMembershipOfAccount[]> {
    const rows = await this.db
      .selectFrom('memberships')
      .innerJoin('workspaces', 'workspaces.id', 'memberships.workspace_id')
      .selectAll('memberships')
      .select('workspaces.name as workspace_name')
      .where('memberships.account_id', '=', accountId)
      .where('memberships.state', '=', 'active')
      .orderBy('memberships.last_used_at', (o) => o.desc().nullsLast())
      .orderBy('memberships.id', 'asc')
      .execute();
    return rows.map(({ workspace_name, ...row }) => ({
      ...toRecord(row),
      workspaceName: workspace_name,
    }));
  }

  async findForGuard(accountId: string, workspaceId: string): Promise<MembershipRecord | null> {
    return this.findByAccount(workspaceId, accountId);
  }
}
