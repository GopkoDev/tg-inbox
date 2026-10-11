import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerErrorHandler } from './errors.js';
import { requireJsonBodies } from './content-type.js';

function build() {
  const app = Fastify();
  registerErrorHandler(app);
  requireJsonBodies(app);
  app.post('/api/act', () => ({ ok: true }));
  app.post('/other', () => ({ ok: true }));
  app.get('/api/read', () => ({ ok: true }));
  return app;
}

describe('requireJsonBodies', () => {
  it('refuses a text/plain POST under /api before the handler runs', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/api/act',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a body-less POST with no content-type', async () => {
    const res = await build().inject({ method: 'POST', url: '/api/act' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts an empty JSON POST', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/api/act',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(200);
  });

  it('leaves GET and non-api routes alone', async () => {
    const app = build();
    expect((await app.inject({ method: 'GET', url: '/api/read' })).statusCode).toBe(200);
    const res = await app.inject({
      method: 'POST',
      url: '/other',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(200);
  });
});
