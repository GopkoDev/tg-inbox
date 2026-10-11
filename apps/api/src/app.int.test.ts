import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { startTestDatabase, testConfig, type TestDatabase } from './test/postgres.js';

describe('skeleton smoke test', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url));
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  it('boots and answers GET /health with a live DB ping', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('refuses a text/plain POST to a mutating /api route before the handler runs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
  });

  it('refuses a body without content-type and answers malformed JSON with 400', async () => {
    const untyped = await app.inject({ method: 'POST', url: '/api/auth/sign-out', payload: 'x' });
    expect(untyped.statusCode).toBe(415);
    expect(untyped.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('answers a malformed URL with 400 VALIDATION_ERROR in the envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/workspaces/%E0%A4%A/memberships',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request URL' },
    });
    expect(response.body).not.toContain('memberships');
  });

  it('answers a path param over the max length with 400 VALIDATION_ERROR (no 414)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${'a'.repeat(120)}/memberships`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request URL' },
    });
    expect(response.body).not.toContain('a'.repeat(120));
  });

  it('answers unknown routes with the error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('link tokens stay out of the request log (review r5 Z2)', () => {
  const token = 'Zk3tokenNeverLogged9xQ';
  const lines: string[] = [];
  let database: TestDatabase;
  let app: FastifyInstance;
  let webDist: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    webDist = await mkdtemp(join(tmpdir(), 'tg-web-dist-'));
    await writeFile(join(webDist, 'index.html'), '<!doctype html><title>tg</title>');
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    app = await buildApp(
      { ...testConfig(database.url), LOG_LEVEL: 'info', WEB_DIST_DIR: webDist },
      { logStream },
    );
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
    if (webDist) await rm(webDist, { recursive: true, force: true });
  });

  it.each(['/invite', '/reset-password'])('logs %s/<token> with the token masked', async (base) => {
    const response = await app.inject({
      method: 'GET',
      url: `${base}/${token}?x=1`,
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(200);
    expect(lines.some((line) => line.includes(`"url":"${base}/[redacted]?x=1"`))).toBe(true);
    expect(lines.filter((line) => line.includes(token))).toEqual([]);
  });

  it('keeps the token out of the log and the body for a malformed link', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/reset-password/${token}%E0%A4%A`,
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(response.body).not.toContain(token);
    expect(lines.some((line) => line.includes('client error'))).toBe(true);
    expect(lines.filter((line) => line.includes(token))).toEqual([]);
  });

  it('logs other urls unchanged', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    expect(lines.some((line) => line.includes('"url":"/health"'))).toBe(true);
  });
});
