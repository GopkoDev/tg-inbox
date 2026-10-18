import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { buildDeps, type Deps } from '../../../deps.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertMembership, T0, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createWorkspaceAccess } from '../app/access.js';
import { KyselyUnitOfWork } from '../infra/unit-of-work.js';
import { createWorkspaceGuard, ownerOnly } from './guard.js';

describe('workspace access routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;
  let deps: Deps;

  beforeAll(async () => {
    database = await startTestDatabase();
    const clock = fixedClock(new Date('2026-03-01T10:00:00Z'));
    app = await buildApp(testConfig(database.url), { clock });
    db = createDb(database.url);

    // Probe routes behind the exported guard, to observe it the way a later module would use it.
    deps = buildDeps(testConfig(database.url), { clock });
    const resolver = deps.authenticate;
    const access = createWorkspaceAccess({
      uow: new KyselyUnitOfWork(db),
      clock,
      auth: { getAccount: async () => undefined, getAccountsByIds: async () => [] },
    });
    const guard = createWorkspaceGuard(access);
    app.get(
      '/api/workspaces/:workspaceId/_probe',
      { preHandler: [resolver, guard] },
      async (r) => ({
        ...r.workspace,
      }),
    );
    app.get(
      '/api/workspaces/:workspaceId/_owner-probe',
      { preHandler: [resolver, guard, ownerOnly('Only business owners manage the team')] },
      async (r) => ({ ...r.workspace }),
    );
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await deps?.destroy();
    await database?.stop();
  });

  /** An account with a live session; memberships are added by the test. */
  const operator = async () => {
    const account = await insertAccount(db);
    const session = await insertSession(db, account.id, {
      createdAt: new Date('2026-03-01T09:00:00Z'),
    });
    return { accountId: account.id, cookies: { session: session.token } };
  };
  const call = (
    who: { cookies: { session: string } } | null,
    method: 'GET' | 'POST',
    url: string,
  ) => app.inject({ method, url, cookies: who?.cookies });
  const deactivate = (membershipId: string) =>
    db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: new Date() })
      .where('id', '=', membershipId)
      .execute();

  it('401 UNAUTHENTICATED without a session, before the guard runs', async () => {
    const { a } = await twoWorkspaces(db);
    for (const url of ['/api/me', '/api/me/workspaces']) {
      const res = await call(null, 'GET', url);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    }
    const enter = await call(null, 'POST', `/api/workspaces/${a}/enter`);
    expect(enter.statusCode).toBe(401);
    expect(enter.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('AC-07/AC-12: enter records the last used workspace; getMe returns it', async () => {
    const { a, b } = await twoWorkspaces(db);
    const op = await operator();
    await insertMembership(db, a, { accountId: op.accountId, role: 'owner' });
    await insertMembership(db, b, { accountId: op.accountId });

    const before = await call(op, 'GET', '/api/me');
    expect(before.statusCode).toBe(200);
    expect(before.json().last_used_workspace_id).toBeNull();
    expect(before.json().account.id).toBe(op.accountId);
    expect(Object.keys(before.json()).sort()).toEqual(['account', 'last_used_workspace_id']);
    expect(Object.keys(before.json().account).sort()).toEqual(['display_name', 'email', 'id']);

    const list = await call(op, 'GET', '/api/me/workspaces');
    expect(
      list
        .json()
        .items.map((i: { id: string }) => i.id)
        .sort(),
    ).toEqual([a, b].sort());

    const entered = await call(op, 'POST', `/api/workspaces/${b}/enter`);
    expect(entered.statusCode).toBe(200);
    expect(entered.json()).toEqual({ id: b, name: 'B', role: 'operator' });
    expect((await call(op, 'GET', '/api/me')).json().last_used_workspace_id).toBe(b);
  });

  it('AC-10: every membership deactivated gives an empty list and no last used workspace', async () => {
    const { a } = await twoWorkspaces(db);
    const op = await operator();
    const m = await insertMembership(db, a, { accountId: op.accountId });
    await call(op, 'POST', `/api/workspaces/${a}/enter`);
    await deactivate(m.id);
    const list = await call(op, 'GET', '/api/me/workspaces');
    expect(list.json()).toEqual({ items: [], has_next: false, has_prev: false, next_cursor: null });
    expect((await call(op, 'GET', '/api/me')).json().last_used_workspace_id).toBeNull();
  });

  it('AC-13/QG-1a: a foreign, unknown and malformed workspace answer identically on every route', async () => {
    const { a, b } = await twoWorkspaces(db);
    const op = await operator();
    await insertMembership(db, a, { accountId: op.accountId });
    const unknownId = '0190a000-0000-7000-8000-000000000000';
    for (const [method, suffix] of [
      ['POST', 'enter'],
      ['GET', '_probe'],
    ] as const) {
      const foreign = await call(op, method, `/api/workspaces/${b}/${suffix}`);
      const unknown = await call(op, method, `/api/workspaces/${unknownId}/${suffix}`);
      const malformed = await call(op, method, `/api/workspaces/not-a-uuid/${suffix}`);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json().error.code).toBe('NOT_FOUND');
      expect(unknown.body).toBe(foreign.body);
      expect(malformed.body).toBe(foreign.body);
    }
  });

  it('AC-17/QG-1b: after deactivation both sessions get ACCESS_REMOVED; the other workspace works', async () => {
    const { a, b } = await twoWorkspaces(db);
    const op = await operator();
    const second = await insertSession(db, op.accountId, {
      createdAt: new Date('2026-03-01T09:00:00Z'),
    });
    const device2 = { cookies: { session: second.token } };
    const ma = await insertMembership(db, a, { accountId: op.accountId });
    await insertMembership(db, b, { accountId: op.accountId });
    for (const who of [op, device2]) {
      expect((await call(who, 'POST', `/api/workspaces/${a}/enter`)).statusCode).toBe(200);
    }
    await deactivate(ma.id);
    for (const who of [op, device2]) {
      const res = await call(who, 'POST', `/api/workspaces/${a}/enter`);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toEqual({
        code: 'ACCESS_REMOVED',
        message: 'Your access to this workspace was removed',
      });
      expect((await call(who, 'GET', `/api/workspaces/${a}/_probe`)).statusCode).toBe(403);
      expect((await call(who, 'POST', `/api/workspaces/${b}/enter`)).statusCode).toBe(200);
    }
  });

  it('guard: attaches workspaceId and role; ownerOnly refuses an operator with OWNER_ONLY', async () => {
    const { a } = await twoWorkspaces(db);
    const owner = await operator();
    const member = await operator();
    await insertMembership(db, a, { accountId: owner.accountId, role: 'owner' });
    await insertMembership(db, a, { accountId: member.accountId });
    expect((await call(owner, 'GET', `/api/workspaces/${a}/_owner-probe`)).json()).toEqual({
      workspaceId: a,
      role: 'owner',
      activeSince: T0.toISOString(),
    });
    expect((await call(member, 'GET', `/api/workspaces/${a}/_probe`)).statusCode).toBe(200);
    const denied = await call(member, 'GET', `/api/workspaces/${a}/_owner-probe`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('OWNER_ONLY');
  });
});
