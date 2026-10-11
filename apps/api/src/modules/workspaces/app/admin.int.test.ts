import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { hashToken } from '../../../platform/tokens.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { KyselyUnitOfWork } from '../infra/unit-of-work.js';
import { createWorkspaceAdmin } from './admin.js';

describe('workspace admin use cases (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let admin: ReturnType<typeof createWorkspaceAdmin>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    admin = createWorkspaceAdmin({
      uow: new KyselyUnitOfWork(db),
      clock: systemClock,
      publicWebUrl: 'http://web.test',
    });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('a created workspace has zero memberships and a pending hashed owner invitation', async () => {
    const r = await admin.createWorkspaceWithOwnerInvitation({
      name: 'Acme',
      ownerEmail: 'Ana@Acme.test',
    });
    const members = await db
      .selectFrom('memberships')
      .selectAll()
      .where('workspace_id', '=', r.workspaceId)
      .execute();
    expect(members).toHaveLength(0);
    const inv = await db
      .selectFrom('invitations')
      .selectAll()
      .where('id', '=', r.invitationId)
      .executeTakeFirstOrThrow();
    expect(inv.state).toBe('pending');
    expect(inv.role).toBe('owner');
    expect(inv.email).toBe('ana@acme.test');
    expect(Buffer.from(inv.token_hash).equals(hashToken(r.link.split('/invite/')[1]!))).toBe(true);
  });

  it('re-issue supersedes the old invitation and the new one is pending', async () => {
    const c = await admin.createWorkspaceWithOwnerInvitation({
      name: 'Beta',
      ownerEmail: 'b@beta.test',
    });
    const r = await admin.reissueOwnerInvitation(c.workspaceId);
    const rows = await db
      .selectFrom('invitations')
      .select(['id', 'state'])
      .where('workspace_id', '=', c.workspaceId)
      .execute();
    expect(rows.find((x) => x.id === c.invitationId)?.state).toBe('superseded');
    expect(rows.find((x) => x.id === r.invitationId)?.state).toBe('pending');
    expect(r.supersededInvitationId).toBe(c.invitationId);
  });
});
