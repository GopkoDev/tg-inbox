import { resolve } from 'node:path';
import type { Config } from '../../../api/src/platform/config.ts';

/** Same shape the API's integration tests use, plus the built SPA so /api and the panel share an origin. */
export function e2eConfig(databaseUrl: string, port: number): Config {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: port,
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: 10,
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: 5000,
    PUBLIC_WEB_URL: `http://localhost:${port}`,
    WEB_DIST_DIR: resolve(import.meta.dirname, '../../dist'),
    TELEGRAM_WEBHOOK_BASE_URL: `http://localhost:${port}`,
    TELEGRAM_WEBHOOK_MAX_CONNECTIONS: 5,
    // Visibly fake test key (never a real secret).
    BOT_TOKEN_ENCRYPTION_KEY: { id: 'test0001', key: Buffer.alloc(32, 0x5a) },
  };
}
