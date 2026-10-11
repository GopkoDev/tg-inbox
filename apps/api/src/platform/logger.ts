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
// The SPA router resolves them after decoding and normalising the path, so the mask works on the same
// normal form (not a pattern over the raw url): `//`, `%2F`, percent-encoded letters, any case and
// `.` / `..` segments all reach the same page.
const LINK_PREFIXES = new Set(['invite', 'reset-password']);

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // undecodable: keep raw, never throw from the serializer
  }
}

/** Masks the token segment of an invitation / reset link; any other url is returned unchanged. */
export function maskLinkTokens(url: string): string {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? '' : url.slice(queryAt);
  const segments: string[] = [];
  for (const raw of path.split(/\/|%2f/i)) {
    const segment = decodeSegment(raw);
    if (segment === '..') segments.pop();
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  const [prefix, token] = segments;
  if (prefix === undefined || token === undefined || !LINK_PREFIXES.has(prefix.toLowerCase())) {
    return url;
  }
  return `/${prefix}/[redacted]${query}`;
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
