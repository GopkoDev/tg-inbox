import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import {
  insertAccountRow,
  insertMembership,
  insertWorkspace,
  T0,
  twoWorkspaces,
} from '../../../test/fixtures/workspaces.js';
import { KyselyMembershipRepo } from './membership-repo.js';
import { KyselyUnitOfWork } from './unit-of-work.js';

describe('KyselyMembershipRepo', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: KyselyMembershipRepo;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = new KyselyMembershipRepo(db);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('insert writes under the given workspace; a second membership for the pair is a unique violation (AC-16)', async () => {
    const { a } = await twoWorkspaces(db);
    const accountId = await insertAccountRow(db);
    const id = newId();
    const rec = {
      id,
      accountId,
      role: 'owner' as const,
      state: 'active' as const,
      lastUsedAt: null,
      deactivatedAt: null,
      createdAt: T0,
      activeSince: T0,
    };
    await repo.insert(a, rec);
    expect(await repo.findById(a, id)).toEqual({ ...rec, workspaceId: a });
    await expect(repo.insert(a, { ...rec, id: newId() })).rejects.toMatchObject({ code: '23505' });
  });

  it('isolation: findById / findByAccount never return the other workspace (AC-13)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ma = await insertMembership(db, a);
    expect(await repo.findById(b, ma.id)).toBeNull();
    expect(await repo.findByAccount(b, ma.accountId)).toBeNull();
    expect((await repo.findByAccount(a, ma.accountId))?.id).toBe(ma.id);
  });

  it('isolation: list, countActiveOwners and hasAnyMember are per workspace', async () => {
    const { a, b } = await twoWorkspaces(db);
    const m1 = await insertMembership(db, a, { role: 'owner' });
    const m2 = await insertMembership(db, a, { role: 'owner', state: 'deactivated' });
    await insertMembership(db, a, { role: 'operator' });
    const mb = await insertMembership(db, b, { role: 'owner' });
    const listA = await repo.list(a, { limit: 50 });
    expect(listA).toHaveLength(3);
    expect(listA.every((m) => m.workspaceId === a)).toBe(true);
    expect((await repo.list(b, { limit: 50 })).map((m) => m.id)).toEqual([mb.id]);
    expect(await repo.countActiveOwners(a)).toBe(1);
    expect(await repo.countActiveOwners(b)).toBe(1);
    expect(await repo.hasAnyMember(a)).toBe(true);
    const empty = await insertWorkspace(db);
    expect(await repo.hasAnyMember(empty)).toBe(false);
    expect(await repo.countActiveOwners(empty)).toBe(0);
    expect([m1.id, m2.id].every((id) => listA.some((m) => m.id === id))).toBe(true);
  });

  it('list pages by id with after / before / limit', async () => {
    const w = await insertWorkspace(db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await insertMembership(db, w)).id);
    ids.sort();
    const p1 = await repo.list(w, { limit: 2 });
    expect(p1.map((m) => m.id)).toEqual(ids.slice(0, 2));
    const p2 = await repo.list(w, { limit: 2, after: ids[1]! });
    expect(p2.map((m) => m.id)).toEqual(ids.slice(2, 4));
    const prev = await repo.list(w, { limit: 2, before: ids[4]! });
    expect(prev.map((m) => m.id)).toEqual(ids.slice(2, 4));
  });

  it('isolation: setState only changes a row of the given workspace', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ma = await insertMembership(db, a);
    expect(await repo.setState(b, ma.id, 'deactivated', T0)).toBe(false);
    expect((await repo.findById(a, ma.id))?.state).toBe('active');
    expect(await repo.setState(a, ma.id, 'deactivated', T0)).toBe(true);
    const row = await repo.findById(a, ma.id);
    expect(row).toMatchObject({ state: 'deactivated', deactivatedAt: T0 });
    expect(await repo.setState(a, ma.id, 'active', null)).toBe(true);
    expect(await repo.findById(a, ma.id)).toMatchObject({ state: 'active', deactivatedAt: null });
  });

  it('isolation: touchLastUsed only changes the given workspace membership of the account', async () => {
    const { a, b } = await twoWorkspaces(db);
    const accountId = await insertAccountRow(db);
    const ma = await insertMembership(db, a, { accountId });
    const mb = await insertMembership(db, b, { accountId });
    const at = new Date('2026-04-01T00:00:00Z');
    expect(await repo.touchLastUsed(a, accountId, at)).toBe(true);
    expect((await repo.findById(a, ma.id))?.lastUsedAt).toEqual(at);
    expect((await repo.findById(b, mb.id))?.lastUsedAt).toBeNull();
    expect(await repo.touchLastUsed(a, await insertAccountRow(db), at)).toBe(false);
  });

  describe('controlled exceptions', () => {
    it('listActiveOfAccount returns only that account active memberships with workspace names, most recently used first', async () => {
      const wa = await insertWorkspace(db, 'Old');
      const wb = await insertWorkspace(db, 'New');
      const wc = await insertWorkspace(db, 'Deactivated');
      const wd = await insertWorkspace(db, 'Other');
      const account = await insertAccountRow(db);
      const other = await insertAccountRow(db);
      await insertMembership(db, wa, { accountId: account, lastUsedAt: new Date('2026-03-02Z') });
      await insertMembership(db, wb, { accountId: account, lastUsedAt: new Date('2026-03-05Z') });
      await insertMembership(db, wc, { accountId: account, state: 'deactivated' });
      await insertMembership(db, wd, { accountId: other });
      const rows = await repo.listActiveOfAccount(account);
      expect(rows.map((r) => r.workspaceName)).toEqual(['New', 'Old']);
      expect(rows.every((r) => r.accountId === account)).toBe(true);
      expect(await repo.listActiveOfAccount(await insertAccountRow(db))).toEqual([]);
    });

    it('findForGuard is scoped by (account, workspace) — an account only in A gets none for B (AC-13)', async () => {
      const { a, b } = await twoWorkspaces(db);
      const ma = await insertMembership(db, a);
      const mb = await insertMembership(db, b);
      expect((await repo.findForGuard(ma.accountId, a))?.id).toBe(ma.id);
      expect(await repo.findForGuard(ma.accountId, b)).toBeNull();
      expect((await repo.findForGuard(mb.accountId, b))?.id).toBe(mb.id);
      expect(await repo.findForGuard(mb.accountId, a)).toBeNull();
    });
  });

  it('lockForUpdate serialises two concurrent transactions on the same workspace (AC-18)', async () => {
    const w = await insertWorkspace(db);
    const uow = new KyselyUnitOfWork(db);
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let firstHasLock!: () => void;
    const locked = new Promise<void>((r) => (firstHasLock = r));

    const first = uow.run(async (r) => {
      await r.workspaces.lockForUpdate(w);
      events.push('first-locked');
      firstHasLock();
      await gate;
      events.push('first-done');
    });
    await locked;
    const second = uow.run(async (r) => {
      await r.workspaces.lockForUpdate(w);
      events.push('second-locked');
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual(['first-locked']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-locked', 'first-done', 'second-locked']);
  });

  it('accountIdsAmong / activeAccountIdsAmong are isolated by workspace and by state', async () => {
    const { a, b } = await twoWorkspaces(db);
    const active = await insertMembership(db, a);
    const off = await insertMembership(db, a, { state: 'deactivated' });
    const other = await insertMembership(db, b);
    const ids = [active.accountId, off.accountId, other.accountId];
    expect((await repo.accountIdsAmong(a, ids)).sort()).toEqual(
      [active.accountId, off.accountId].sort(),
    );
    expect(await repo.activeAccountIdsAmong(a, ids)).toEqual([active.accountId]);
    expect(await repo.activeAccountIdsAmong(b, ids)).toEqual([other.accountId]);
    expect(await repo.activeAccountIdsAmong(a, [])).toEqual([]);
  });

  it('setState moves active_since only when given; findForGuard returns it', async () => {
    const { a } = await twoWorkspaces(db);
    const m = await insertMembership(db, a);
    const later = new Date('2026-04-01T00:00:00Z');
    await repo.setState(a, m.id, 'deactivated', later);
    expect((await repo.findForGuard(m.accountId, a))?.activeSince).toEqual(T0);
    await repo.setState(a, m.id, 'active', null, later);
    expect((await repo.findForGuard(m.accountId, a))?.activeSince).toEqual(later);
  });

  it('isolation: lockActiveAccountIds / listActiveAccountIds only see the given workspace (AC-04)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ma = await insertMembership(db, a);
    const gone = await insertMembership(db, a, { state: 'deactivated' });
    const mb = await insertMembership(db, b);
    const ids = [ma.accountId, gone.accountId, mb.accountId];
    expect(await repo.listActiveAccountIds(a)).toEqual([ma.accountId]);
    expect(await repo.listActiveAccountIds(b)).toEqual([mb.accountId]);
    const locked = await db
      .transaction()
      .execute((tx) => new KyselyMembershipRepo(tx).lockActiveAccountIds(a, ids));
    expect(locked).toEqual([ma.accountId]);
    expect(await repo.lockActiveAccountIds(b, [])).toEqual([]);
  });

  it('lockActiveAccountIds takes FOR SHARE: a concurrent state UPDATE waits for the transaction', async () => {
    const { a } = await twoWorkspaces(db);
    const m = await insertMembership(db, a);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let taken!: () => void;
    const lockTaken = new Promise<void>((r) => (taken = r));
    const holder = db.transaction().execute(async (tx) => {
      await new KyselyMembershipRepo(tx).lockActiveAccountIds(a, [m.accountId]);
      taken();
      await hold;
    });
    await lockTaken;
    let done = false;
    const update = repo.setState(a, m.id, 'deactivated', new Date()).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    release();
    await holder;
    await update;
    expect(done).toBe(true);
  });
});
