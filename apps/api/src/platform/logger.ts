import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

// Bot tokens and webhook secrets are tenant secrets — never logged.
const REDACT = [
  'req.headers.authorization',
  'req.headers["x-telegram-bot-api-secret-token"]',
  '*.token',
  '*.botToken',
];

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: REDACT,
    ...(config.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
  };
}
