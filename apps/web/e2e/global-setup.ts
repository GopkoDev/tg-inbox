import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { buildApp } from '../../api/src/app.ts';
import { startTestDatabase } from '../../api/src/test/postgres.ts';
import { e2eConfig } from './support/config.ts';

const WEB_DIR = resolve(import.meta.dirname, '..');

/** Ephemeral Postgres (migrated) + the API serving the freshly built SPA on one origin. */
export default async function globalSetup(config: FullConfig) {
  const run = (...args: string[]) => execFileSync('pnpm', args, { cwd: WEB_DIR, stdio: 'inherit' });
  run('exec', 'vite', 'build');

  const database = await startTestDatabase();
  process.env.E2E_DATABASE_URL = database.url;
  const port = Number(new URL(config.projects[0]!.use.baseURL!).port);
  process.env.E2E_PORT = String(port);
  const app = await buildApp(e2eConfig(database.url, port));
  await app.listen({ host: '127.0.0.1', port });

  return async () => {
    await app.close();
    await database.stop();
  };
}
