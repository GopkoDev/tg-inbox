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

  it('answers unknown routes with the error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
