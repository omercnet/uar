import { defineConfig } from '@playwright/test';

/**
 * Playwright harness scaffold for UAR E2E tests.
 * Real specs land in Task 14 (e2e/review-flow.spec.ts). This config only
 * establishes the harness so `e2e/**` is isolated from the Vitest unit runner.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
});
