import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { loggerOptions, maskLinkTokens } from './logger.js';

describe('maskLinkTokens', () => {
  it.each([
    ['/invite/tok123', '/invite/[redacted]'],
    ['/reset-password/tok123', '/reset-password/[redacted]'],
    ['/invite/tok123?x=1', '/invite/[redacted]?x=1'],
    ['/reset-password/tok%E0%A4%A', '/reset-password/[redacted]'],
    ['/invite/tok123/', '/invite/[redacted]/'],
  ])('masks %s', (url, masked) => {
    expect(maskLinkTokens(url)).toBe(masked);
  });

  it.each([
    '/api/workspaces/0190a1b2-0000-7000-8000-000000000000',
    '/api/invitations/accept',
    '/invite',
    '/health?x=1',
    '/assets/invite/x.js',
  ])('leaves %s unchanged', (url) => {
    expect(maskLinkTokens(url)).toBe(url);
  });
});

describe('loggerOptions req serializer', () => {
  const config = { LOG_LEVEL: 'info', NODE_ENV: 'test' } as Config;

  function serialize(url: string): Record<string, unknown> {
    const options = loggerOptions(config) as {
      serializers: { req: (req: FastifyRequest) => Record<string, unknown> };
    };
    return options.serializers.req({
      method: 'GET',
      url,
      host: 'localhost:3000',
      ip: '127.0.0.1',
      headers: {},
      socket: { remotePort: 51000 },
    } as unknown as FastifyRequest);
  }

  it('logs method, masked url, host and remote address', () => {
    expect(serialize('/invite/tok123?x=1')).toEqual({
      method: 'GET',
      url: '/invite/[redacted]?x=1',
      host: 'localhost:3000',
      remoteAddress: '127.0.0.1',
      remotePort: 51000,
    });
  });

  it('keeps other urls as they are', () => {
    expect(serialize('/api/workspaces/abc').url).toBe('/api/workspaces/abc');
  });

  it('keeps every existing redact path', () => {
    const options = loggerOptions(config) as { redact: string[] };
    expect(options.redact).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.headers["x-telegram-bot-api-secret-token"]',
        '*.token',
        '*.botToken',
      ]),
    );
  });
});
