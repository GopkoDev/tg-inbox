import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

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
});

export type Config = z.infer<typeof ConfigSchema>;

// Repo-root .env (platform → src → api → apps → root); same depth from dist/.
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

/** The only place that reads process.env — everything else receives a Config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return ConfigSchema.parse(env);
}
