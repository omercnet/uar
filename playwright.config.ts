import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright harness for the UAR full-flow e2e (Task 14).
 *
 * `webServer` boots BOTH services the flow needs:
 *   1. the in-memory single-tenant API harness (e2e/harness/server.ts) on :3001
 *      — binds the real domain logic to the REST contract apps/web expects.
 *   2. the Next.js admin/reviewer UI (`next start`) on :3000.
 *
 * The web bundle bakes NEXT_PUBLIC_API_URL at build time; with no env set it
 * defaults to http://localhost:3001 (see apps/web/src/lib/api.ts), which is
 * exactly where the harness listens — so `pnpm -r build` then `pnpm e2e` works
 * with no extra wiring. Run `pnpm --filter @uar/web build` before the e2e
 * (the repo build gate already does).
 *
 * Infra gating: the spec performs a reachability preflight against the API
 * base URL and test.skip()s cleanly when the stack is unreachable, mirroring
 * the repo's existing DB-gated tests so the unit suite stays green.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? '3000');
const API_PORT = Number(process.env.UAR_E2E_API_PORT ?? '3001');
const WEB_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;
const API_BASE_URL = process.env.E2E_API_URL ?? `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
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
      command: 'pnpm --config.verify-deps-before-run=false exec tsx e2e/harness/server.ts',
      url: `${API_BASE_URL}/health`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { UAR_E2E_API_PORT: String(API_PORT) },
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
