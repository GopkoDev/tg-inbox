import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IssuedInvitation, MembershipPage, PendingInvitationPage } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { hashToken } from '../../../platform/tokens.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import {
  insertInvitation,
  insertMembership,
  insertWorkspace,
  twoWorkspaces,
} from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-03-01T10:00:00Z');

describe('owner-only team routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url), { clock: fixedClock(NOW) });
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  type Who = { accountId: string; cookies: { session: string } };
  const member = async (
    workspaceId: string,
    role: 'owner' | 'operator',
    state: 'active' | 'deactivated' = 'active',
  ): Promise<Who & { membershipId: string }> => {
    const account = await insertAccount(db);
    const session = await insertSession(db, account.id, {
      createdAt: new Date('2026-03-01T09:00:00Z'),
    });
    const m = await insertMembership(db, workspaceId, { accountId: account.id, role, state });
    return { accountId: account.id, cookies: { session: session.token }, membershipId: m.id };
  };
  const call = (who: Who, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who.cookies, payload });
  const base = (ws: string) => `/api/workspaces/${ws}`;
  const unknownId = '0190a000-0000-7000-8000-000000000000';

  it('AC-14: invite returns 201 with the link once; it is not in the list; earlier invitation superseded', async () => {
    const ws = await insertWorkspace(db);
    const owner = await member(ws, 'owner');
    const first = await call(owner, 'POST', `${base(ws)}/invitations`, {
      email: '  New.Hire@Example.com ',
      role: 'operator',
    });
    expect(first.statusCode).toBe(201);
    const issued = IssuedInvitation.parse(first.json());
    expect(issued.invitation.email).toBe('new.hire@example.com');
    expect(issued.link).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(
      Date.parse(issued.invitation.expires_at) - Date.parse(issued.invitation.created_at),
    ).toBe(7 * 86_400_000);

    const second = await call(owner, 'POST', `${base(ws)}/invitations`, {
      email: 'new.hire@example.com',
      role: 'owner',
    });
    expect(second.statusCode).toBe(201);
    const list = await call(owner, 'GET', `${base(ws)}/invitations`);
    const page = PendingInvitationPage.parse(list.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.role).toBe('owner');
    expect(list.body).not.toContain('link');
    expect(list.body).not.toContain(issued.link.split('/invite/')[1]!);
    const old = await db
      .selectFrom('invitations')
      .select('state')
      .where('id', '=', issued.invitation.id)
      .executeTakeFirstOrThrow();
    expect(old.state).toBe('superseded');
  });

  it('400 VALIDATION_ERROR for an unknown role or bad email', async () => {
    const ws = await insertWorkspace(db);
    const owner = await member(ws, 'owner');
    for (const body of [
      { email: 'a@b.com', role: 'admin' },
      { email: 'nope', role: 'operator' },
    ]) {
      const res = await call(owner, 'POST', `${base(ws)}/invitations`, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('AC-15: an operator is refused with OWNER_ONLY on all six routes', async () => {
    const ws = await insertWorkspace(db);
    const op = await member(ws, 'operator');
    const inv = await insertInvitation(db, ws);
    const calls: ['GET' | 'POST', string, object?][] = [
      ['GET', `${base(ws)}/memberships`],
      ['POST', `${base(ws)}/memberships/${op.membershipId}/deactivate`],
      ['POST', `${base(ws)}/memberships/${op.membershipId}/reactivate`],
      ['GET', `${base(ws)}/invitations`],
      ['POST', `${base(ws)}/invitations`, { email: 'x@y.com', role: 'operator' }],
      ['POST', `${base(ws)}/invitations/${inv.id}/revoke`],
    ];
    for (const [m, url, body] of calls) {
      const res = await call(op, m, url, body);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe('OWNER_ONLY');
    }
  });

  it('a deactivated owner gets ACCESS_REMOVED', async () => {
    const ws = await insertWorkspace(db);
    const gone = await member(ws, 'owner', 'deactivated');
    const res = await call(gone, 'GET', `${base(ws)}/memberships`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCESS_REMOVED');
  });

  it('AC-16: inviting an active or deactivated member is 409 ALREADY_A_MEMBER with details', async () => {
    const ws = await insertWorkspace(db);
    const owner = await member(ws, 'owner');
    for (const state of ['active', 'deactivated'] as const) {
      const account = await insertAccount(db);
      const m = await insertMembership(db, ws, { accountId: account.id, state });
      const res = await call(owner, 'POST', `${base(ws)}/invitations`, {
        email: account.email.toUpperCase(),
        role: 'operator',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_A_MEMBER');
      expect(res.json().error.details).toEqual({ membership_id: m.id, state });
    }
  });

  it('AC-18: self-deactivation allowed with a second owner; last owner is 409', async () => {
    const ws = await insertWorkspace(db);
    const o1 = await member(ws, 'owner');
    const o2 = await member(ws, 'owner');
    const ok = await call(o1, 'POST', `${base(ws)}/memberships/${o1.membershipId}/deactivate`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe('deactivated');
    const last = await call(o2, 'POST', `${base(ws)}/memberships/${o2.membershipId}/deactivate`);
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('LAST_ACTIVE_OWNER');
  });

  it('AC-18: two parallel deactivations of the last two owners leave exactly one 200', async () => {
    const ws = await insertWorkspace(db);
    const o1 = await member(ws, 'owner');
    const o2 = await member(ws, 'owner');
    const results = await Promise.all([
      call(o1, 'POST', `${base(ws)}/memberships/${o2.membershipId}/deactivate`),
      call(o2, 'POST', `${base(ws)}/memberships/${o1.membershipId}/deactivate`),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const other = results.find((r) => r.statusCode !== 200)!;
    expect([403, 409]).toContain(other.statusCode);
    const active = await db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', ws)
      .where('state', '=', 'active')
      .execute();
    expect(active).toHaveLength(1);
  });

  it('AC-19: reactivation restores access with the previous role; repeated calls are no-ops', async () => {
    const ws = await insertWorkspace(db);
    const owner = await member(ws, 'owner');
    const op = await member(ws, 'operator');
    const d = await call(owner, 'POST', `${base(ws)}/memberships/${op.membershipId}/deactivate`);
    expect(d.statusCode).toBe(200);
    const d2 = await call(owner, 'POST', `${base(ws)}/memberships/${op.membershipId}/deactivate`);
    expect(d2.json().deactivated_at).toBe(d.json().deactivated_at);
    expect((await call(op, 'POST', `${base(ws)}/enter`)).statusCode).toBe(403);
    const r = await call(owner, 'POST', `${base(ws)}/memberships/${op.membershipId}/reactivate`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ role: 'operator', state: 'active', deactivated_at: null });
    const r2 = await call(owner, 'POST', `${base(ws)}/memberships/${op.membershipId}/reactivate`);
    expect(r2.statusCode).toBe(200);
    expect((await call(op, 'POST', `${base(ws)}/enter`)).statusCode).toBe(200);
  });

  it('AC-20: lists members and pending invitations without links; revoke removes it', async () => {
    const ws = await insertWorkspace(db);
    const owner = await member(ws, 'owner');
    await member(ws, 'operator');
    await member(ws, 'operator', 'deactivated');
    const inv = await insertInvitation(db, ws, { expiresAt: new Date(NOW.getTime() + 86_400_000) });
    const members = MembershipPage.parse(
      (await call(owner, 'GET', `${base(ws)}/memberships`)).json(),
    );
    expect(members.items).toHaveLength(3);
    expect(members.items.map((m) => m.state).sort()).toEqual(['active', 'active', 'deactivated']);
    const pending = PendingInvitationPage.parse(
      (await call(owner, 'GET', `${base(ws)}/invitations`)).json(),
    );
    expect(pending.items.map((i) => i.id)).toEqual([inv.id]);

    const rev = await call(owner, 'POST', `${base(ws)}/invitations/${inv.id}/revoke`);
    expect(rev.statusCode).toBe(204);
    const after = PendingInvitationPage.parse(
      (await call(owner, 'GET', `${base(ws)}/invitations`)).json(),
    );
    expect(after.items).toEqual([]);
    const row = await db
      .selectFrom('invitations')
      .select('state')
      .where('token_hash', '=', hashToken(inv.token))
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('revoked');
    const again = await call(owner, 'POST', `${base(ws)}/invitations/${inv.id}/revoke`);
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('NOT_FOUND');
  });

  it('QG-1a: another workspace session and foreign ids are 404 and change nothing', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ownerA = await member(a, 'owner');
    const opB = await member(b, 'operator');
    const invB = await insertInvitation(db, b);

    const foreign: ['GET' | 'POST', string, object?][] = [
      ['GET', `${base(b)}/memberships`],
      ['POST', `${base(b)}/memberships/${opB.membershipId}/deactivate`],
      ['POST', `${base(b)}/memberships/${opB.membershipId}/reactivate`],
      ['GET', `${base(b)}/invitations`],
      ['POST', `${base(b)}/invitations`, { email: 'x@y.com', role: 'operator' }],
      ['POST', `${base(b)}/invitations/${invB.id}/revoke`],
    ];
    for (const [m, url, body] of foreign) {
      const res = await call(ownerA, m, url, body);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
    for (const url of [
      `${base(a)}/memberships/${opB.membershipId}/deactivate`,
      `${base(a)}/memberships/${opB.membershipId}/reactivate`,
      `${base(a)}/memberships/${unknownId}/deactivate`,
      `${base(a)}/invitations/${invB.id}/revoke`,
    ]) {
      const res = await call(ownerA, 'POST', url);
      expect(res.statusCode, url).toBe(404);
    }
    const mb = await db
      .selectFrom('memberships')
      .select('state')
      .where('id', '=', opB.membershipId)
      .executeTakeFirstOrThrow();
    const ib = await db
      .selectFrom('invitations')
      .select('state')
      .where('id', '=', invB.id)
      .executeTakeFirstOrThrow();
    expect(mb.state).toBe('active');
    expect(ib.state).toBe('pending');
  });
});
