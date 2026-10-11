import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import type { DestinationStream } from 'pino';
import type { Config } from './config.js';

// Bot tokens and webhook secrets are tenant secrets — never logged. `err.rawPacket` holds the raw
// bytes of a request Fastify could not parse (logged at trace): its path may carry a link token.
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.headers["x-telegram-bot-api-secret-token"]',
  '*.token',
  '*.botToken',
  'err.rawPacket',
];

// Invitation and reset links carry their token in the path (`/invite/<t>`, `/reset-password/<t>`).
// The SPA router matches them case-insensitively, so any case, extra leading slashes or `%2F` too.
const LINK_TOKEN_PATH = /^(\/+(?:invite|reset-password)(?:\/|%2f))[^/?]+/i;

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
