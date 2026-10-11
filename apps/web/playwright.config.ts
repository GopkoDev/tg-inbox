import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4399);

// The API serves the built SPA, so the panel and /api are one origin (cookie + guard paths are real).
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1, // flows share one database and reset it before each test
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
