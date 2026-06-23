import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e — Next.js serves both UI and API routes at /api/*.
 * globalSetup drops + re-migrates Postgres and seeds STUB_AUTHZ tenant + reviewer.
 * One webServer: Next.js on :3100 (host holds :3000).
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? '3100');
const WEB_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://uar:uar_dev_password@localhost:5433/uar';
const STUB_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STUB_USER_ID = '22222222-2222-4222-8222-222222222222';
const INGEST_CSV = resolve(process.cwd(), 'e2e/fixtures/access.csv');

const webEnv: Record<string, string> = {
  STUB_AUTHZ: 'true',
  NODE_ENV: 'development',
  UAR_STUB_TENANT_ID: STUB_TENANT_ID,
  UAR_STUB_USER_ID: STUB_USER_ID,
  UAR_STUB_ROLES: 'admin',
  DATABASE_URL,
  UAR_INGEST_CSV: INGEST_CSV,
};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/bootstrap.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node_modules/.bin/next start -p ${WEB_PORT}`,
    cwd: resolve(process.cwd(), 'apps/web'),
    url: WEB_BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: webEnv,
  },
});
