import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { fixedClock, type FixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { hashToken } from '../../../platform/tokens.js';
import { insertAccount, insertResetLink, insertSession } from '../../../test/fixtures/auth.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';
import { createAccountUseCases } from '../app/accounts.js';
import { createSessionUseCases } from '../app/sessions.js';
import { createAccountRepo } from '../infra/account-repo.js';
import { createPasswordHasher } from '../infra/password-hasher.js';
import { createSessionRepo } from '../infra/session-repo.js';
import { createSessionResolver } from './session-resolver.js';

const PASSWORD = 'correct horse battery';
const DAY = 86_400_000;

describe('auth routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;
  let clock: FixedClock;
  let passwordHash: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    clock = fixedClock(new Date('2026-03-01T10:00:00Z'));
    app = await buildApp(testConfig(database.url), { clock });
    db = createDb(database.url);
    passwordHash = await createPasswordHasher().hash(PASSWORD);
    // A probe route guarded by the exported resolver, to observe session behaviour on any route.
    const hasher = createPasswordHasher();
    const resolver = createSessionResolver({
      sessionUseCases: createSessionUseCases({ sessions: createSessionRepo(db), clock }),
      accountUseCases: createAccountUseCases({ accounts: createAccountRepo(db), hasher, clock }),
    });
    app.get('/api/_probe', { preHandler: resolver }, async (request) => ({
      id: request.account.id,
    }));
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  const account = (email: string) => insertAccount(db, { email, passwordHash });
  const signIn = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email, password } });
  const sessionCount = async (accountId: string) =>
    Number(
      (
        await db
          .selectFrom('sessions')
          .select(db.fn.countAll().as('n'))
          .where('account_id', '=', accountId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  const cookieOf = (res: LightMyRequestResponse) => {
    const c = res.cookies.find((x) => x.name === 'session');
    if (!c) throw new Error('no session cookie');
    return c;
  };

  it('AC-08: signs in with a cookie; unknown email and wrong password answer identically', async () => {
    const a = await account('ok@example.test');
    const ok = await signIn(' OK@Example.test ', PASSWORD);
    expect(ok.statusCode).toBe(204);
    const raw = String(ok.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Secure/i);
    expect(await sessionCount(a.id)).toBe(1);

    const unknown = await signIn('nobody@example.test', 'whatever-long');
    const wrong = await signIn('ok@example.test', 'wrong-password');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
    expect(unknown.json()).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
    });
  });

  it('rejects an invalid body and non-JSON bodies', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    const text = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { 'content-type': 'text/plain' },
      payload: 'email=a',
    });
    expect([400, 415]).toContain(text.statusCode);
  });

  it('AC-09 / QG-2a: locks after 10 failures, identical for unknown email, lifts 15 min after the 10th', async () => {
    await account('lock@example.test');
    for (let i = 0; i < 10; i++) {
      await signIn('lock@example.test', 'bad-password');
      await signIn('ghost@example.test', 'bad-password');
    }
    const lockedReal = await signIn('lock@example.test', PASSWORD);
    const lockedGhost = await signIn('ghost@example.test', PASSWORD);
    expect(lockedReal.statusCode).toBe(429);
    expect(lockedReal.json()).toEqual({
      error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts, try again later' },
    });
    expect(lockedGhost.statusCode).toBe(429);
    expect(lockedGhost.body).toBe(lockedReal.body);

    clock.advance(15 * 60_000 + 1000);
    expect((await signIn('lock@example.test', PASSWORD)).statusCode).toBe(204);
  });

  it('AC-09: 20 parallel wrong passwords record at most 10 failures; the rest get 429 (known and unknown email)', async () => {
    await account('burst@example.test');
    for (const email of ['burst@example.test', 'void@example.test']) {
      const res = await Promise.all(
        Array.from({ length: 20 }, () => signIn(email, 'bad-password')),
      );
      expect(res.filter((r) => r.statusCode === 401)).toHaveLength(10);
      expect(res.filter((r) => r.statusCode === 429)).toHaveLength(10);
      const n = await db
        .selectFrom('sign_in_failures')
        .select(db.fn.countAll().as('n'))
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(10);
    }
    expect((await signIn('burst@example.test', PASSWORD)).statusCode).toBe(429);
  });

  it('AC-07: signing in again with a live cookie ends the previous session', async () => {
    const a = await account('again@example.test');
    const old = cookieOf(await signIn('again@example.test', PASSWORD));
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'again@example.test', password: PASSWORD },
      cookies: { session: old.value },
    });
    expect(res.statusCode).toBe(204);
    const fresh = cookieOf(res);
    expect(await sessionCount(a.id)).toBe(1);
    const stale = await app.inject({
      method: 'GET',
      url: '/api/_probe',
      cookies: { session: old.value },
    });
    expect(stale.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/_probe',
      cookies: { session: fresh.value },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('AC-11: sign-out ends only this session and clears the cookie; tolerates no cookie', async () => {
    const a = await account('out@example.test');
    const one = cookieOf(await signIn('out@example.test', PASSWORD));
    const two = cookieOf(await signIn('out@example.test', PASSWORD));
    expect(await sessionCount(a.id)).toBe(2);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      cookies: { session: one.value },
    });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/session=;.*Max-Age=0/i);
    expect(await sessionCount(a.id)).toBe(1);
    const left = await db
      .selectFrom('sessions')
      .select('token_hash')
      .where('account_id', '=', a.id)
      .executeTakeFirstOrThrow();
    expect(Buffer.from(left.token_hash).equals(hashToken(two.value))).toBe(true);

    const none = await app.inject({ method: 'POST', url: '/api/auth/sign-out' });
    expect(none.statusCode).toBe(204);
  });

  it('QG-2b: background requests do not extend the idle window; user actions do', async () => {
    const a = await account('idle@example.test');
    const bg = (await insertSession(db, a.id, { lastSeenAt: clock.now() })).token;
    const user = (await insertSession(db, a.id, { lastSeenAt: clock.now() })).token;
    const probe = (token: string, background: boolean) =>
      app.inject({
        method: 'GET',
        url: '/api/_probe',
        cookies: { session: token },
        headers: background ? { 'x-background-request': '1' } : {},
      });

    clock.advance(29 * DAY);
    expect((await probe(bg, true)).statusCode).toBe(200);
    expect((await probe(user, false)).statusCode).toBe(200);
    clock.advance(2 * DAY);
    const dead = await probe(bg, true);
    expect(dead.statusCode).toBe(401);
    expect(dead.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect((await probe(user, false)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/_probe' })).statusCode).toBe(401);
  });

  it('AC-21: redeeming a reset link signs in, ends other sessions, single use', async () => {
    const a = await account('reset@example.test');
    await insertSession(db, a.id);
    await insertSession(db, a.id);
    const { token } = await insertResetLink(db, a.id, { createdAt: clock.now() });

    const short = await app.inject({
      method: 'POST',
      url: '/api/password-reset-links/redeem',
      payload: { token, password: 'short' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(await sessionCount(a.id)).toBe(2);

    const lookup = await app.inject({
      method: 'POST',
      url: '/api/password-reset-links/lookup',
      payload: { token },
    });
    expect(lookup.statusCode).toBe(204);

    const res = await app.inject({
      method: 'POST',
      url: '/api/password-reset-links/redeem',
      payload: { token, password: 'a brand new password' },
    });
    expect(res.statusCode).toBe(204);
    expect(cookieOf(res).value).toHaveLength(43);
    expect(await sessionCount(a.id)).toBe(1);
    expect((await signIn('reset@example.test', 'a brand new password')).statusCode).toBe(204);

    const again = await app.inject({
      method: 'POST',
      url: '/api/password-reset-links/redeem',
      payload: { token, password: 'another password!' },
    });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ error: { code: 'RESET_LINK_INVALID' } });
  });

  it('AC-22: expired and used links answer 404 RESET_LINK_INVALID', async () => {
    const a = await account('stale@example.test');
    const expired = await insertResetLink(db, a.id, {
      createdAt: new Date(clock.now().getTime() - 2 * DAY),
    });
    const used = await insertResetLink(db, a.id, { state: 'used', createdAt: clock.now() });
    for (const { token } of [expired, used]) {
      for (const [url, payload] of [
        ['/api/password-reset-links/lookup', { token }],
        ['/api/password-reset-links/redeem', { token, password: 'a brand new password' }],
      ] as const) {
        const res = await app.inject({ method: 'POST', url, payload });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ error: { code: 'RESET_LINK_INVALID' } });
      }
    }
  });
});
