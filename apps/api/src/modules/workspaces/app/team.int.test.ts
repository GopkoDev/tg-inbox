import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { LastActiveOwnerError, NotFoundError } from '../../../platform/errors.js';
import { hashToken } from '../../../platform/tokens.js';
import {
  insertAccountRow,
  insertInvitation,
  insertMembership,
  insertWorkspace,
  T0,
  twoWorkspaces,
} from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { KyselyUnitOfWork } from '../infra/unit-of-work.js';
import { publish } from '../../../platform/realtime.js';
import { createTeam } from './team.js';

describe('team use cases (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let team: ReturnType<typeof createTeam>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    team = createTeam({
      uow: new KyselyUnitOfWork(db),
      clock: systemClock,
      publish,
      publicWebUrl: 'http://web.test',
      accounts: {
        findAccountIdByEmail: async (email) =>
          (
            await db
              .selectFrom('accounts')
              .select('id')
              .where('email', '=', email)
              .executeTakeFirst()
          )?.id,
        getAccountsByIds: async (ids) =>
          (
            await db
              .selectFrom('accounts')
              .select(['id', 'email', 'display_name'])
              .where('id', 'in', [...ids])
              .execute()
          ).map((a) => ({ id: a.id, email: a.email, displayName: a.display_name })),
      },
    });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('AC-18: two concurrent deactivations of the only two owners — exactly one succeeds', async () => {
    const ws = await insertWorkspace(db);
    const m1 = await insertMembership(db, ws, { role: 'owner' });
    const m2 = await insertMembership(db, ws, { role: 'owner' });
    const results = await Promise.allSettled([
      team.deactivateMembership(ws, m1.id),
      team.deactivateMembership(ws, m2.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(LastActiveOwnerError);
    const active = await db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', ws)
      .where('state', '=', 'active')
      .execute();
    expect(active).toHaveLength(1);
  });

  it('AC-19: reactivation restores the active state and keeps the role', async () => {
    const ws = await insertWorkspace(db);
    const m = await insertMembership(db, ws, { role: 'owner', state: 'deactivated' });
    const r = await team.reactivateMembership(ws, m.id);
    expect(r).toMatchObject({ state: 'active', role: 'owner', deactivatedAt: null });
    const row = await db
      .selectFrom('memberships')
      .select('active_since')
      .where('id', '=', m.id)
      .executeTakeFirstOrThrow();
    expect(row.active_since.getTime()).toBeGreaterThan(T0.getTime());
  });

  it('AC-09: deactivation keeps active_since and signals membership.deactivated; a refused one does not', async () => {
    const listener = new pg.Client({ connectionString: database.url });
    await listener.connect();
    await listener.query('LISTEN realtime');
    const got: unknown[] = [];
    listener.on('notification', (n) => got.push(JSON.parse(n.payload ?? 'null')));
    try {
      const ws = await insertWorkspace(db);
      const only = await insertMembership(db, ws, { role: 'owner' });
      const op = await insertMembership(db, ws);
      await expect(team.deactivateMembership(ws, only.id)).rejects.toBeInstanceOf(
        LastActiveOwnerError,
      );
      await team.deactivateMembership(ws, op.id);
      await new Promise((r) => setTimeout(r, 300));
      expect(got).toEqual([
        { type: 'membership.deactivated', v: 1, workspace_id: ws, account_id: op.accountId },
      ]);
      const row = await db
        .selectFrom('memberships')
        .select('active_since')
        .where('id', '=', op.id)
        .executeTakeFirstOrThrow();
      expect(row.active_since).toEqual(T0);
    } finally {
      await listener.end();
    }
  });

  it('AC-14/AC-20: invite supersedes, lists without a link, and a revoked invitation is not pending', async () => {
    const ws = await insertWorkspace(db);
    const first = await team.inviteMember(ws, { email: 'New@X.test', role: 'operator' });
    const second = await team.inviteMember(ws, { email: 'new@x.test', role: 'operator' });
    const pending = await team.listPendingInvitations(ws, { limit: 10 });
    expect(pending.items.map((i) => i.id)).toEqual([second.invitation.id]);
    await team.revokeInvitation(ws, second.invitation.id);
    const row = await db
      .selectFrom('invitations')
      .select('state')
      .where('token_hash', '=', hashToken(second.link.split('/invite/')[1]!))
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('revoked');
    expect((await team.listPendingInvitations(ws, { limit: 10 })).items).toHaveLength(0);
    expect(first.invitation.id).not.toBe(second.invitation.id);
  });

  it('AC-16: inviting an existing member (deactivated too) is refused', async () => {
    const ws = await insertWorkspace(db);
    const accountId = await insertAccountRow(db, 'bob@x.test');
    await insertMembership(db, ws, { accountId, state: 'deactivated' });
    await expect(
      team.inviteMember(ws, { email: 'bob@x.test', role: 'operator' }),
    ).rejects.toMatchObject({ details: { state: 'deactivated' } });
  });

  it('isolation: ids from another workspace are not found, lists never leak (AC-13)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const m = await insertMembership(db, b);
    const inv = await insertInvitation(db, b);
    await expect(team.deactivateMembership(a, m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(team.reactivateMembership(a, m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(team.revokeInvitation(a, inv.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await team.listMemberships(a, { limit: 10 })).items).toHaveLength(0);
    expect((await team.listPendingInvitations(a, { limit: 10 })).items).toHaveLength(0);
  });
});
