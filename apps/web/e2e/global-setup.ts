import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { buildApp } from '../../api/src/app.ts';
import { startFakeTelegram } from '../../api/src/test/fake-telegram.ts';
import { startTestDatabase } from '../../api/src/test/postgres.ts';
import { e2eConfig } from './support/config.ts';

const WEB_DIR = resolve(import.meta.dirname, '..');

/**
 * Ephemeral Postgres (migrated) + the fake Bot API + the API serving the freshly built SPA on one
 * origin. The workers drive the fake over its control API (`connectFakeTelegram`).
 */
export default async function globalSetup(config: FullConfig) {
  // An empty VITE_API_URL makes the client call relative /api paths, whatever a local .env says
  // (process env wins over .env files in Vite), so the SPA and the API share one origin.
  const run = (...args: string[]) =>
    execFileSync('pnpm', args, {
      cwd: WEB_DIR,
      stdio: 'inherit',
      env: { ...process.env, VITE_API_URL: '' },
    });
  run('exec', 'vite', 'build');

  const database = await startTestDatabase();
  const fake = await startFakeTelegram();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    process.env.E2E_DATABASE_URL = database.url;
    process.env.E2E_TELEGRAM_API_ROOT = fake.apiRoot;
    const port = Number(new URL(config.projects[0]!.use.baseURL!).port);
    process.env.E2E_PORT = String(port);
    app = await buildApp(e2eConfig(database.url, port, fake.apiRoot));
    await app.listen({ host: '127.0.0.1', port });
  } catch (err) {
    await app?.close().catch(() => undefined);
    await fake.stop();
    await database.stop();
    throw err;
  }
  const started = app;

  return async () => {
    try {
      await started.close();
    } finally {
      await fake.stop();
      await database.stop();
    }
  };
}
