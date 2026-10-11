import { ErrorCode } from '@tg/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiRequest } from './client';

const Pong = z.object({ ok: z.boolean() });

function mockFetch(response: Response) {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('parses a success body with the schema', async () => {
    mockFetch(Response.json({ ok: true }));
    await expect(apiRequest('/api/ping', Pong)).resolves.toEqual({ ok: true });
  });

  it('turns the error envelope into a typed ApiError', async () => {
    mockFetch(
      Response.json(
        { error: { code: ErrorCode.ACCESS_REMOVED, message: 'gone', details: { a: 1 } } },
        { status: 403 },
      ),
    );
    const err = await apiRequest('/api/x', Pong).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'ACCESS_REMOVED', message: 'gone' });
  });

  it('maps an envelope-less error body to INTERNAL_ERROR with the status text', async () => {
    mockFetch(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }));
    const err = await apiRequest('/api/x', Pong).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'INTERNAL_ERROR', message: 'Bad Gateway' });
  });

  it('sends X-Background-Request only for background requests', async () => {
    const fn = mockFetch(Response.json({ ok: true }));
    await apiRequest('/api/ping', Pong, { background: true });
    expect(new Headers(fn.mock.calls[0]![1].headers).get('x-background-request')).toBe('1');
    fn.mockResolvedValue(Response.json({ ok: true }));
    await apiRequest('/api/ping', Pong);
    expect(new Headers(fn.mock.calls[1]![1].headers).has('x-background-request')).toBe(false);
  });

  it('sends same-origin credentials', async () => {
    const fn = mockFetch(Response.json({ ok: true }));
    await apiRequest('/api/ping', Pong);
    expect(fn.mock.calls[0]![1].credentials).toBe('same-origin');
  });

  it('tolerates an empty 204 when no schema is given', async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(apiRequest('/api/logout', undefined, { method: 'POST' })).resolves.toBeUndefined();
  });
});
