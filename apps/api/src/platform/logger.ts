import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import type { DestinationStream } from 'pino';
import type { Config } from './config.js';

// Bot tokens and webhook secrets are tenant secrets — never logged.
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.headers["x-telegram-bot-api-secret-token"]',
  '*.token',
  '*.botToken',
];

// Invitation and reset links carry their token in the path (`/invite/<t>`, `/reset-password/<t>`).
const LINK_TOKEN_PATH = /^(\/(?:invite|reset-password)\/)[^/?]+/;

/** Masks the token segment of an invitation / reset link; any other url is returned unchanged. */
export function maskLinkTokens(url: string): string {
  return url.replace(LINK_TOKEN_PATH, '$1[redacted]');
}

/** Fastify's default `req` serializer (minus `version`: no route versioning), link tokens masked. */
function serializeRequest(req: FastifyRequest): Record<string, unknown> {
  return {
    method: req.method,
    url: maskLinkTokens(req.url),
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/** `stream` replaces stdout (tests capture the log with it). */
export function loggerOptions(
  config: Config,
  stream?: DestinationStream,
): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: REDACT,
    serializers: { req: serializeRequest },
    ...(stream && { stream }),
    ...(config.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
  };
}
