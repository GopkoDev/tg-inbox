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
  'headers["x-telegram-bot-api-secret-token"]',
  '*.token',
  '*.botToken',
  'err.rawPacket',
];

// Invitation and reset links carry their token in the path (`/invite/<t>`, `/reset-password/<t>`).
// The mask works on a normalised path, not a pattern over the raw url, and covers a superset on
// purpose: every form the SPA router or Fastify resolves to a link route (any case, encoded letters,
// an absolute-form `http://host/...` target), plus forms no router resolves but a client may still
// send (`//`, `%2F`, `\`, `%5C`, `.` / `..` segments). Once the normalised path is exactly a link
// prefix, whatever follows is masked, even when a later `..` walks back over the token.
const LINK_PREFIXES = new Set(['invite', 'reset-password']);
const ABSOLUTE_FORM_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i;

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
  const path = (queryAt === -1 ? url : url.slice(0, queryAt)).replace(ABSOLUTE_FORM_AUTHORITY, '');
  const query = queryAt === -1 ? '' : url.slice(queryAt);
  const segments: string[] = [];
  for (const raw of path.split(/\/|\\|%2f|%5c/i)) {
    const segment = decodeSegment(raw);
    if (segment === '') continue;
    const [prefix] = segments;
    if (segments.length === 1 && prefix !== undefined && LINK_PREFIXES.has(prefix.toLowerCase())) {
      return `/${prefix}/[redacted]${query}`;
    }
    if (segment === '..') segments.pop();
    else if (segment !== '.') segments.push(segment);
  }
  return url;
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
