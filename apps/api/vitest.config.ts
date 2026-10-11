import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['development'] },
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Integration suites start a Testcontainers Postgres in beforeAll.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
