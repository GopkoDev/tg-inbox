import { defineConfig } from 'kysely-ctl';
import pg from 'pg';
import { loadConfig } from './src/platform/config.js';

const config = loadConfig();

export default defineConfig({
  dialect: 'pg',
  dialectConfig: { pool: new pg.Pool({ connectionString: config.DATABASE_URL }) },
  migrations: { migrationFolder: 'migrations' },
});
