import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { hashToken } from '../../../platform/tokens.js';
import { insertAccount, insertSession, insertSignInFailures } from '../../../test/fixtures/auth.js';
import {
  insertInvitation,
  insertMembership,
  insertWorkspace,
  T0,
} from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createPasswordHasher } from '../../auth/infra/password-hasher.js';

const PASSWORD = 'correct horse battery';
const NOW = new Date(T0.getTime() + 60_000);

describe('invitation routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;
  let passwordHash: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url), { clock: fixedClock(NOW) });
    db = createDb(database.url);
    passwordHash = await createPasswordHasher().hash(PASSWORD);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  const lookup = (token: string, cookies?: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/invitations/lookup', payload: { token }, cookies });
  const accept = (payload: Record<string, unknown>, cookies?: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/invitations/accept', payload, cookies });
  const accountRows = (email: string) =>
    db.selectFrom('accounts').select('id').where('email', '=', email).execute();
  const membershipsOf = (accountId: string) =>
    db
      .selectFrom('memberships')
      .select('workspace_id')
      .where('account_id', '=', accountId)
      .execute();

  it('AC-03: a new person gets an account, a membership and a session cookie', async () => {
    const ws = await insertWorkspace(db, 'Acme');
    const inv = await insertInvitation(db, ws, { email: 'new@x.com', role: 'operator' });

    const preview = await lookup(inv.token);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      workspace_name: 'Acme',
      email: 'new@x.com',
      role: 'operator',
      account_exists: false,
    });

    const res = await accept({ token: inv.token, password: PASSWORD, display_name: 'Nina' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ws, name: 'Acme', role: 'operator' });
    const cookie = res.cookies.find((c) => c.name === 'session');
    expect(cookie?.value).toBeTruthy();
    const [account] = await accountRows('new@x.com');
    expect(await membershipsOf(account!.id)).toEqual([{ workspace_id: ws }]);
    const session = await db
      .selectFrom('sessions')
      .select('account_id')
      .where('token_hash', '=', hashToken(cookie!.value))
      .executeTakeFirst();
    expect(session?.account_id).toBe(account!.id);
  });

  it('AC-04: an existing account confirms its password; other memberships stay', async () => {
    const other = await insertWorkspace(db, 'Other');
    const ws = await insertWorkspace(db, 'Second');
    const acc = await insertAccount(db, { email: 'old@x.com', passwordHash });
    await insertMembership(db, other, { accountId: acc.id, role: 'owner' });
    const inv = await insertInvitation(db, ws, { email: 'old@x.com' });

    expect((await lookup(inv.token)).json().account_exists).toBe(true);
    const res = await accept({ token: inv.token, password: PASSWORD, display_name: 'Ignored' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ws, name: 'Second', role: 'operator' });
    expect((await membershipsOf(acc.id)).map((m) => m.workspace_id).sort()).toEqual(
      [other, ws].sort(),
    );
    expect(await accountRows('old@x.com')).toHaveLength(1);
  });

  it('AC-04: signed in as the invited email, the old session is ended and replaced', async () => {
    const ws = await insertWorkspace(db, 'Third');
    const acc = await insertAccount(db, { email: 'same@x.com', passwordHash });
    const old = await insertSession(db, acc.id, { createdAt: NOW });
    const inv = await insertInvitation(db, ws, { email: 'same@x.com' });

    const res = await accept({ token: inv.token, password: PASSWORD }, { session: old.token });
    expect(res.statusCode).toBe(200);
    const fresh = res.cookies.find((c) => c.name === 'session')!.value;
    expect(fresh).not.toBe(old.token);
    const gone = await db
      .selectFrom('sessions')
      .select('id')
      .where('token_hash', '=', hashToken(old.token))
      .executeTakeFirst();
    expect(gone).toBeUndefined();
  });

  it('AC-04: a wrong existing password is 401 and counts toward lockout', async () => {
    const ws = await insertWorkspace(db);
    await insertAccount(db, { email: 'wrong@x.com', passwordHash });
    const inv = await insertInvitation(db, ws, { email: 'wrong@x.com' });

    const res = await accept({ token: inv.token, password: 'not the password' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    const failures = await db
      .selectFrom('sign_in_failures')
      .select('id')
      .where('email', '=', 'wrong@x.com')
      .execute();
    expect(failures).toHaveLength(1);
  });

  it('AC-04: a locked-out email is refused with the generic credentials error', async () => {
    const ws = await insertWorkspace(db);
    await insertAccount(db, { email: 'locked@x.com', passwordHash });
    await insertSignInFailures(
      db,
      'locked@x.com',
      Array.from({ length: 10 }, (_, i) => new Date(NOW.getTime() - 1000 * (i + 1))),
    );
    const inv = await insertInvitation(db, ws, { email: 'locked@x.com' });

    const res = await accept({ token: inv.token, password: PASSWORD });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(await membershipsOfEmail('locked@x.com')).toHaveLength(0);
  });

  async function membershipsOfEmail(email: string) {
    const [a] = await accountRows(email);
    return a ? membershipsOf(a.id) : [];
  }

  it('AC-04b: a different signed-in account gets 403 and no membership', async () => {
    const ws = await insertWorkspace(db);
    const me = await insertAccount(db, { email: 'me@x.com', passwordHash });
    const session = await insertSession(db, me.id, { createdAt: NOW });
    const inv = await insertInvitation(db, ws, { email: 'someone-else@x.com' });

    const looked = await lookup(inv.token, { session: session.token });
    expect(looked.statusCode).toBe(403);
    expect(looked.json().error.code).toBe('INVITATION_FOR_ANOTHER_EMAIL');
    const res = await accept({ token: inv.token, password: PASSWORD }, { session: session.token });
    expect(res.statusCode).toBe(403);
    expect(await membershipsOf(me.id)).toHaveLength(0);
  });

  it('AC-05: a short password is 400 with field password and writes nothing', async () => {
    const ws = await insertWorkspace(db);
    const inv = await insertInvitation(db, ws, { email: 'short@x.com' });

    const res = await accept({ token: inv.token, password: 'short', display_name: 'Sam' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'password' },
    });
    expect(await accountRows('short@x.com')).toHaveLength(0);
    const still = await db
      .selectFrom('invitations')
      .select('state')
      .where('id', '=', inv.id)
      .executeTakeFirst();
    expect(still?.state).toBe('pending');
  });

  it('a missing display_name for a new account is 400 with field display_name', async () => {
    const ws = await insertWorkspace(db);
    const inv = await insertInvitation(db, ws, { email: 'noname@x.com' });
    const res = await accept({ token: inv.token, password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toMatchObject({ field: 'display_name' });
    expect(await accountRows('noname@x.com')).toHaveLength(0);
  });

  it('AC-06: expired, accepted, revoked and superseded links are 404 with the right ask', async () => {
    const ws = await insertWorkspace(db);
    await insertMembership(db, ws, { role: 'owner' });
    const empty = await insertWorkspace(db);
    const cases = [
      await insertInvitation(db, ws, { expiresAt: new Date(T0.getTime() + 1000) }),
      await insertInvitation(db, ws, { state: 'accepted' }),
      await insertInvitation(db, ws, { state: 'revoked' }),
      await insertInvitation(db, ws, { state: 'superseded' }),
    ];
    for (const inv of cases) {
      for (const res of [
        await lookup(inv.token),
        await accept({ token: inv.token, password: PASSWORD, display_name: 'X' }),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error).toMatchObject({
          code: 'INVITATION_INVALID',
          details: { ask: 'business_owner' },
        });
      }
    }
    const firstOwner = await insertInvitation(db, empty, {
      role: 'owner',
      expiresAt: new Date(T0.getTime() + 1000),
    });
    expect((await lookup(firstOwner.token)).json().error.details).toEqual({ ask: 'tg_inbox_team' });
  });

  it('an unknown token is 404 business_owner and a malformed one is 400', async () => {
    const unknown = await lookup('a'.repeat(43));
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.details).toEqual({ ask: 'business_owner' });
    expect((await lookup('bad')).statusCode).toBe(400);
  });

  it.each([
    ['a new account', 'long-new@x.com', false],
    ['an existing account', 'long-old@x.com', true],
  ])(
    'AC-05b: a password over 1024 characters for %s is 400 with the shared message',
    async (_who, email, existing) => {
      const ws = await insertWorkspace(db);
      if (existing) await insertAccount(db, { email, passwordHash });
      const inv = await insertInvitation(db, ws, { email });
      const res = await accept({
        token: inv.token,
        password: 'x'.repeat(1025),
        display_name: 'Sam',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'The password must be at most 1024 characters long',
        details: { field: 'password' },
      });
    },
  );

  it('AC-05b: a blank display_name is 400 with the shared message, no field prefix', async () => {
    const ws = await insertWorkspace(db);
    const inv = await insertInvitation(db, ws, { email: 'blank@x.com' });
    const res = await accept({ token: inv.token, password: PASSWORD, display_name: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      message: 'Enter your name (up to 200 characters)',
      details: { field: 'display_name' },
    });
  });
});
