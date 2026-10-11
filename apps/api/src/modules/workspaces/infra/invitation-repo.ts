import type { Kysely, Selectable } from 'kysely';
import type { DB, Invitations } from '../../../platform/db.types.gen.js';
import type { Role } from '../domain/membership.js';
import type {
  InvitationRecord,
  InvitationRepo,
  InvitationState,
  InvitationWithWorkspace,
  PageQuery,
} from '../app/ports.js';

function toRecord(row: Selectable<Invitations>): InvitationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role as Role,
    tokenHash: row.token_hash,
    state: row.state as InvitationState,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export class KyselyInvitationRepo implements InvitationRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async insert(workspaceId: string, i: Omit<InvitationRecord, 'workspaceId'>): Promise<void> {
    await this.db
      .insertInto('invitations')
      .values({
        id: i.id,
        workspace_id: workspaceId,
        email: i.email,
        role: i.role,
        token_hash: i.tokenHash,
        state: i.state,
        expires_at: i.expiresAt,
        created_at: i.createdAt,
        closed_at: i.closedAt,
      })
      .execute();
  }

  async consume(workspaceId: string, tokenHash: Buffer, now: Date): Promise<boolean> {
    const res = await this.db
      .updateTable('invitations')
      .set({ state: 'accepted', closed_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('token_hash', '=', tokenHash)
      .where('state', '=', 'pending')
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async supersedePending(workspaceId: string, email: string, now: Date): Promise<number> {
    const res = await this.db
      .updateTable('invitations')
      .set({ state: 'superseded', closed_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('email', '=', email)
      .where('state', '=', 'pending')
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  async listPending(workspaceId: string, now: Date, page: PageQuery): Promise<InvitationRecord[]> {
    let q = this.db
      .selectFrom('invitations')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('state', '=', 'pending')
      .where('expires_at', '>', now);
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

  async findLatest(workspaceId: string): Promise<InvitationRecord | null> {
    const row = await this.db
      .selectFrom('invitations')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async revoke(workspaceId: string, invitationId: string, now: Date): Promise<boolean> {
    const res = await this.db
      .updateTable('invitations')
      .set({ state: 'revoked', closed_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', invitationId)
      .where('state', '=', 'pending')
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async findByTokenHash(tokenHash: Buffer): Promise<InvitationWithWorkspace | null> {
    const row = await this.db
      .selectFrom('invitations')
      .innerJoin('workspaces', 'workspaces.id', 'invitations.workspace_id')
      .selectAll('invitations')
      .select('workspaces.name as workspace_name')
      .where('invitations.token_hash', '=', tokenHash)
      .executeTakeFirst();
    if (!row) return null;
    const { workspace_name, ...inv } = row;
    return { ...toRecord(inv), workspaceName: workspace_name };
  }
}
