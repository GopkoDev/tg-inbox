import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { buildDeps } from './deps.js';
import { createDb, type Db } from './platform/db.js';
import { createPasswordHasher } from './modules/auth/infra/password-hasher.js';
import { insertAccount } from './test/fixtures/auth.js';
import { startTestDatabase, testConfig, type TestDatabase } from './test/postgres.js';

const PASSWORD = 'correct horse battery';
const INDEX = '<!doctype html><title>panel</title>';

describe('same-origin SPA serving and sign-out (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    const dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dist, 'index.html'), INDEX);
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1);');
    writeFileSync(join(dist, 'notifications-sw.js'), 'self.addEventListener("install",()=>{});');
    app = await buildApp({ ...testConfig(database.url), WEB_DIST_DIR: dist });
    db = createDb(database.url);
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  it('falls back to index.html for SPA routes that accept HTML', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/w/abc/team',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
  });

  it('serves static assets as files, not the fallback', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1);');
  });

  it('serves the notifications worker from the root as JavaScript that is never cached (AC-02)', async () => {
    for (const url of ['/notifications-sw.js', '/notifications-sw.js?v=1']) {
      const res = await app.inject({ method: 'GET', url, headers: { accept: '*/*' } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/javascript/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('addEventListener');
    }
    // Other assets keep the static handler's defaults.
    const other = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(other.headers['cache-control']).not.toBe('no-cache');
  });

  it('keeps the JSON 404 envelope under /api and /health alive', async () => {
    const nope = await app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: { accept: 'text/html' },
    });
    expect(nope.statusCode).toBe(404);
    expect(nope.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('AC-11: sign-in, sign-out, then /api/me asks to sign in again', async () => {
    const hash = await createPasswordHasher().hash(PASSWORD);
    await insertAccount(db, { email: 'out@example.test', passwordHash: hash });
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'out@example.test', password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(204);
    const session = signIn.cookies.find((c) => c.name === 'session');
    if (!session) throw new Error('no session cookie');
    const cookies = { session: session.value };

    expect((await app.inject({ method: 'GET', url: '/api/me', cookies })).statusCode).toBe(200);
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      cookies,
      payload: {},
    });
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/me', cookies })).statusCode).toBe(401);
  });

  it('buildDeps exposes the shared graph and a destroy()', async () => {
    const deps = buildDeps(testConfig(database.url));
    expect(deps.workspaceAdmin).toBeDefined();
    expect(deps.authenticate).toBeTypeOf('function');
    await deps.destroy();
  });
});
