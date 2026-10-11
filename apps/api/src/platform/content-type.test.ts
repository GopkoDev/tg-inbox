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
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('refuses a body sent with no content-type', async () => {
    const res = await build().inject({ method: 'POST', url: '/api/act', payload: 'x' });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('keeps Fastify 4xx statuses without error-level logs', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: { level: 'trace', stream: { write: (l: string) => void lines.push(l) } },
    });
    registerErrorHandler(app);
    app.post('/api/act', () => ({ ok: true }));
    const json = { 'content-type': 'application/json' };
    const bad = await app.inject({ method: 'POST', url: '/api/act', headers: json, payload: '{' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    const empty = await app.inject({ method: 'POST', url: '/api/act', headers: json, payload: '' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('VALIDATION_ERROR');
    const plain = await app.inject({
      method: 'POST',
      url: '/api/act',
      headers: { 'content-type': 'application/xml' },
      payload: 'x',
    });
    expect(plain.statusCode).toBe(415);
    expect(plain.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(
      lines.map((l) => JSON.parse(l) as { level: number }).filter((l) => l.level >= 50),
    ).toEqual([]);
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
