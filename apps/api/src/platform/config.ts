import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** AES-256-GCM key for bot tokens (ADR-0006); the key id is derived so a rotation is detectable. */
export interface BotTokenEncryptionKey {
  /** First 4 bytes of SHA-256(key), hex — stored in front of every ciphertext. */
  id: string;
  key: Buffer;
}

/** The key with its derived id: the first 4 bytes of SHA-256(key), hex. */
export function botTokenEncryptionKey(key: Buffer): BotTokenEncryptionKey {
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

// Issues never echo the value (zod omits the input unless asked), so a bad key is not logged.
const BotTokenEncryptionKeySchema = z
  .string({ error: 'BOT_TOKEN_ENCRYPTION_KEY is required (32 bytes, base64)' })
  .trim()
  .refine((v) => BASE64.test(v) && Buffer.from(v, 'base64').length === 32, {
    error: 'BOT_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded',
  })
  .transform((v) => botTokenEncryptionKey(Buffer.from(v, 'base64')));

/** Default `max_connections` for setWebhook; kept below the database pool size. */
const DEFAULT_WEBHOOK_MAX_CONNECTIONS = 10;

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  PUBLIC_WEB_URL: z.url(),
  WEB_DIST_DIR: z.string().min(1).optional(),
  /** Public HTTPS base for webhook URLs; defaults to PUBLIC_WEB_URL (same origin). */
  TELEGRAM_WEBHOOK_BASE_URL: z.url().optional(),
  BOT_TOKEN_ENCRYPTION_KEY: BotTokenEncryptionKeySchema,
  TELEGRAM_WEBHOOK_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).optional(),
  /** Bot API base URL; unset = Telegram's. Tests point it at a fake Bot API. */
  TELEGRAM_API_ROOT: z.url().optional(),
});

const ResolvedConfigSchema = ConfigSchema.transform((c, ctx) => {
  // One bot must not be able to hold every database connection.
  const maxConnections =
    c.TELEGRAM_WEBHOOK_MAX_CONNECTIONS ??
    Math.min(DEFAULT_WEBHOOK_MAX_CONNECTIONS, c.DATABASE_POOL_MAX - 1);
  if (maxConnections < 1 || maxConnections >= c.DATABASE_POOL_MAX) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_WEBHOOK_MAX_CONNECTIONS'],
      message: 'TELEGRAM_WEBHOOK_MAX_CONNECTIONS must be below DATABASE_POOL_MAX',
    });
    return z.NEVER;
  }
  // Telegram accepts only HTTPS webhooks: in production an http base would make every connect
  // look like "Telegram is not responding".
  const webhookBaseUrl = c.TELEGRAM_WEBHOOK_BASE_URL ?? c.PUBLIC_WEB_URL;
  if (c.NODE_ENV === 'production' && new URL(webhookBaseUrl).protocol !== 'https:') {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_WEBHOOK_BASE_URL'],
      message: 'TELEGRAM_WEBHOOK_BASE_URL (default PUBLIC_WEB_URL) must be https in production',
    });
    return z.NEVER;
  }
  return {
    ...c,
    TELEGRAM_WEBHOOK_BASE_URL: webhookBaseUrl,
    TELEGRAM_WEBHOOK_MAX_CONNECTIONS: maxConnections,
  };
});

export type Config = z.output<typeof ResolvedConfigSchema>;

// Repo-root .env (platform → src → api → apps → root); same depth from dist/.
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

/** The only place that reads process.env — everything else receives a Config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return ResolvedConfigSchema.parse(env);
}
