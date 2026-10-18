import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { AccessRemovedError, NotFoundError } from '../../../platform/errors.js';
import {
  insertAccountRow,
  insertMembership,
  T0,
  twoWorkspaces,
} from '../../../test/fixtures/workspaces.js';
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

  it('AC-04: lockActiveMembers returns only active accounts of that workspace and blocks a concurrent deactivation until commit', async () => {
    const { a, b } = await twoWorkspaces(db);
    const active = await insertMembership(db, a);
    const gone = await insertMembership(db, a, { state: 'deactivated' });
    const other = await insertMembership(db, b);
    const ids = [active.accountId, gone.accountId, other.accountId];
    await expect(
      db.transaction().execute((tx) => access.lockActiveMembers(tx, a, ids)),
    ).resolves.toEqual([active.accountId]);
    await expect(
      db.transaction().execute((tx) => access.lockActiveMembers(tx, b, ids)),
    ).resolves.toEqual([other.accountId]);
    await expect(
      db.transaction().execute((tx) => access.lockActiveMembers(tx, a, [])),
    ).resolves.toEqual([]);

    let releaseLock!: () => void;
    const hold = new Promise<void>((r) => (releaseLock = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    const holder = db.transaction().execute(async (tx) => {
      await access.lockActiveMembers(tx, a, [active.accountId]);
      locked();
      await hold;
    });
    await lockTaken;
    let updated = false;
    const deactivation = db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: new Date() })
      .where('id', '=', active.id)
      .execute()
      .then(() => (updated = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(updated).toBe(false);
    releaseLock();
    await holder;
    await deactivation;
    expect(updated).toBe(true);
  });

  it('AC-04: activeMembers lists active members only, by display name then account id, per workspace', async () => {
    const { a, b } = await twoWorkspaces(db);
    const named = async (n: string) => {
      const id = await insertAccountRow(db);
      await db.updateTable('accounts').set({ display_name: n }).where('id', '=', id).execute();
      return id;
    };
    const zed = await named('Zed');
    const ana = await named('Ana');
    const gone = await named('Aaron');
    const elsewhere = await named('Abe');
    await insertMembership(db, a, { accountId: zed });
    await insertMembership(db, a, { accountId: ana });
    await insertMembership(db, a, { accountId: gone, state: 'deactivated' });
    await insertMembership(db, b, { accountId: elsewhere });
    await expect(access.activeMembers(a)).resolves.toEqual([
      { accountId: ana, displayName: 'Ana' },
      { accountId: zed, displayName: 'Zed' },
    ]);
    await expect(access.activeMembers(b)).resolves.toEqual([
      { accountId: elsewhere, displayName: 'Abe' },
    ]);
  });
});
