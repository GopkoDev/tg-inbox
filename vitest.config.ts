import { defineConfig } from 'vitest/config';

// One `pnpm test` runs every workspace's suite; each project has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
