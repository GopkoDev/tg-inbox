import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { AccessRemovedError, NotFoundError } from '../../../platform/errors.js';
import { insertMembership, T0, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { KyselyUnitOfWork } from '../infra/unit-of-work.js';
import { createWorkspaceAccess } from './access.js';

describe('workspace access (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let access: ReturnType<typeof createWorkspaceAccess>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    access = createWorkspaceAccess({
      uow: new KyselyUnitOfWork(db),
      clock: systemClock,
      auth: {
        getAccount: async () => undefined,
        getAccountsByIds: async (ids) =>
          (
            await db
              .selectFrom('accounts')
              .select(['id', 'email', 'display_name'])
              .where('id', 'in', [...ids])
              .execute()
          ).map((r) => ({ id: r.id, email: r.email, displayName: r.display_name })),
      },
    });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('AC-13: guarding workspace B with an account of A is NotFoundError, also for a malformed id', async () => {
    const { a, b } = await twoWorkspaces(db);
    const m = await insertMembership(db, a);
    await expect(access.guardWorkspace(m.accountId, a)).resolves.toMatchObject({ workspaceId: a });
    await expect(access.guardWorkspace(m.accountId, b)).rejects.toBeInstanceOf(NotFoundError);
    await expect(access.guardWorkspace(m.accountId, 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('AC-17: deactivation is effective on the next call; the other membership still passes', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ma = await insertMembership(db, a, { role: 'owner' });
    await insertMembership(db, b, { accountId: ma.accountId });
    await expect(access.guardWorkspace(ma.accountId, a)).resolves.toEqual({
      workspaceId: a,
      role: 'owner',
      activeSince: T0,
    });
    await db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: new Date() })
      .where('id', '=', ma.id)
      .execute();
    await expect(access.guardWorkspace(ma.accountId, a)).rejects.toBeInstanceOf(AccessRemovedError);
    await expect(access.guardWorkspace(ma.accountId, b)).resolves.toMatchObject({ workspaceId: b });
    await expect(access.listMyWorkspaces(ma.accountId, { limit: 10 })).resolves.toMatchObject({
      items: [{ id: b, name: 'B' }],
    });
  });

  it('AC-12: enterWorkspace records last_used_at on the membership', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ma = await insertMembership(db, a);
    await insertMembership(db, b, { accountId: ma.accountId });
    await expect(access.enterWorkspace(ma.accountId, b)).resolves.toMatchObject({
      id: b,
      name: 'B',
    });
    const row = await db
      .selectFrom('memberships')
      .select('last_used_at')
      .where('workspace_id', '=', b)
      .where('account_id', '=', ma.accountId)
      .executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
  });

  it('AC-09: activeMembersAmong and displayNames are isolated by workspace; names outlive deactivation', async () => {
    const { a, b } = await twoWorkspaces(db);
    const live = await insertMembership(db, a);
    const off = await insertMembership(db, a, { state: 'deactivated' });
    const stranger = await insertMembership(db, b);
    const ids = [live.accountId, off.accountId, stranger.accountId];
    expect(await access.activeMembersAmong(a, ids)).toEqual([live.accountId]);
    const names = await access.displayNames(a, ids);
    expect([...names.keys()].sort()).toEqual([live.accountId, off.accountId].sort());
    expect(names.get(off.accountId)).toBe('Test');
  });
});
