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

  it('answers unknown routes with the error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
