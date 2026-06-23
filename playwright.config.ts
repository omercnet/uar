import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright harness for the UAR full-flow e2e (Task 14), driving the REAL
 * production api server (apps/api/src/server.ts) + the Next.js UI.
 *
 * `globalSetup` (e2e/bootstrap.ts) drops + re-migrates a clean Postgres schema
 * (creating the uar_app RLS role) and seeds the STUB_AUTHZ tenant + reviewer.
 *
 * `webServer` boots:
 *   1. the real api server on :3001 in STUB_AUTHZ mode (no Descope project
 *      needed) against Postgres :5433, ingesting the bundled CSV fixture.
 *   2. the Next.js admin/reviewer UI (`next start`) on :3100 (host holds :3000).
 *
 * The web bundle bakes NEXT_PUBLIC_API_URL at build time; with no env it
 * defaults to http://localhost:3001 (apps/web/src/lib/api.ts) — where the api
 * server listens — so cross-origin browser calls hit the real backend.
 *
 * Infra gating: the spec preflights GET /health and test.skip()s cleanly when
 * the stack is unreachable, so the unit suite stays green without Postgres.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? '3100');
const API_PORT = Number(process.env.UAR_E2E_API_PORT ?? '3001');
const WEB_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;
const API_BASE_URL = process.env.E2E_API_URL ?? `http://localhost:${API_PORT}`;

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://uar:uar_dev_password@localhost:5433/uar';
const STUB_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STUB_USER_ID = '22222222-2222-4222-8222-222222222222';
const INGEST_CSV = resolve(process.cwd(), 'e2e/fixtures/access.csv');

const apiServerEnv: Record<string, string> = {
  STUB_AUTHZ: 'true',
  NODE_ENV: 'development',
  UAR_STUB_TENANT_ID: STUB_TENANT_ID,
  UAR_STUB_USER_ID: STUB_USER_ID,
  UAR_STUB_ROLES: 'admin',
  DATABASE_URL,
  UAR_INGEST_CSV: INGEST_CSV,
  PORT: String(API_PORT),
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
  webServer: [
    {
      command: 'pnpm --config.verify-deps-before-run=false --filter @uar/api exec tsx src/server.ts',
      url: `${API_BASE_URL}/health`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiServerEnv,
    },
    {
      command: `pnpm --config.verify-deps-before-run=false --filter @uar/web exec next start -p ${WEB_PORT}`,
      url: WEB_BASE_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
