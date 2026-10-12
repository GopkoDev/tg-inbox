import { connect } from 'node:net';
import { Writable } from 'node:stream';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { loggerOptions, maskLinkTokens } from './logger.js';

describe('maskLinkTokens', () => {
  it.each([
    ['/invite/tok123', '/invite/[redacted]'],
    ['/reset-password/tok123', '/reset-password/[redacted]'],
    ['/invite/tok123?x=1', '/invite/[redacted]?x=1'],
    ['/reset-password/tok%E0%A4%A', '/reset-password/[redacted]'],
  ])('masks the canonical %s exactly', (url, masked) => {
    expect(maskLinkTokens(url)).toBe(masked);
  });

  // Non-canonical forms: the mask covers a superset on purpose — every form the SPA router or
  // Fastify resolves to a link route (case, encoded letters, absolute-form targets), plus forms no
  // router resolves but a client may still send (extra slashes, `%2F`, `\`, `%5C`, dot segments).
  // The token must not be logged; the normalised prefix that is logged instead is free-form.
  it.each([
    '/invite/tok123/',
    '/Invite/tok123',
    '/INVITE/tok123?x=1',
    '//invite/tok123',
    '/invite%2Ftok123',
    '/invite%2ftok123',
    '/Reset-Password/tok123',
    '/invite//tok123',
    '/%69nvite/tok123',
    '/%49NVITE/tok123',
    '/./invite/tok123',
    '/x/../invite/tok123',
    '/reset-password//tok123',
    'http://host/invite/tok123',
    'HTTP://host/Invite/tok123?x=1',
    'http://host/reset-password/tok123',
    '/invite/tok123/..',
    '/invite/tok123/%2e%2e',
    '/invite/tok123%2F..',
    '/invite/%2e%2e/tok123',
    '/invite\\tok123',
    '\\invite\\tok123',
    '/reset-password\\tok123',
    '/invite%5Ctok123',
    '/invite%5ctok123',
    '/reset-password%5Ctok123',
  ])('hides the token in %s', (url) => {
    const masked = maskLinkTokens(url);
    expect(masked).not.toContain('tok123');
    expect(masked).toContain('[redacted]');
  });

  it('keeps the query of a non-canonical link', () => {
    expect(maskLinkTokens('/invite//tok123?x=1')).toContain('?x=1');
  });

  it('keeps the query of an absolute-form link', () => {
    expect(maskLinkTokens('HTTP://host/Invite/tok123?x=1')).toBe('/Invite/[redacted]?x=1');
  });

  it.each([
    '/api/workspaces/0190a1b2-0000-7000-8000-000000000000',
    '/api/invitations/accept',
    '/invite',
    '/invite/',
    '/invitex/tok123',
    '/',
    '/api/health',
    '/health?x=1',
    '/assets/invite/x.js',
    '/%E0%A4%A',
    'http://host/assets/invite/x.js',
    'http://host/',
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

describe('loggerOptions at trace (review r6 AA2)', () => {
  const token = 'Zk3tokenNeverLogged9xQ';

  it('redacts the raw request bytes Fastify logs for an unparseable request', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    const app = Fastify({
      logger: loggerOptions({ LOG_LEVEL: 'trace', NODE_ENV: 'test' } as Config, stream),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { port } = app.server.address() as { port: number };
      await new Promise<void>((resolve) => {
        const socket = connect(port, '127.0.0.1', () =>
          socket.write(`GET /invite/${token} HTTP/1.1\r\nHost: x\r\nBad\u0001Header: y\r\n\r\n`),
        );
        socket.on('data', () => undefined);
        socket.on('close', () => resolve());
      });
    } finally {
      await app.close();
    }
    const clientError = lines
      .map((line) => JSON.parse(line) as { msg?: string; err?: { rawPacket?: unknown } })
      .find((entry) => entry.msg === 'client error');
    expect(clientError?.err?.rawPacket).toBe('[Redacted]');
  });
});

describe('loggerOptions request headers', () => {
  it('never logs the Telegram webhook secret header of a request', async () => {
    const secret = 'webhookSecretNeverLogged_42';
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    const app = Fastify({
      logger: loggerOptions({ LOG_LEVEL: 'trace', NODE_ENV: 'test' } as Config, stream),
    });
    app.post('/api/telegram/webhook/x', (request) => {
      request.log.info({ headers: request.headers }, 'webhook headers');
      return { ok: true };
    });
    await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook/x',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: {},
    });
    await app.close();
    expect(lines.join('\n')).not.toContain(secret);
    const entry = lines
      .map((line) => JSON.parse(line) as { msg?: string; headers?: Record<string, string> })
      .find((e) => e.msg === 'webhook headers');
    expect(entry?.headers?.['x-telegram-bot-api-secret-token']).toBe('[Redacted]');
  });
});
