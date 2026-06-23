import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

/**
 * Full access-review flow, end-to-end, driving the real Next.js UI against the
 * REAL api server (apps/api/src/server.ts) + Postgres:
 *
 *   create campaign -> activate -> ingest (CSV connector -> materialize -> freeze)
 *   -> reviewer decisions (approve / revoke / exception / needs_follow_up)
 *   -> finalize (reproducible content-hash artifact) -> CSV evidence export.
 *
 * Single-tenant (STUB_AUTHZ), on a frozen snapshot, with a reproducible content
 * hash (re-finalize is idempotent and returns the same hash).
 *
 * The api server assigns server-generated UUID campaign ids, so the campaign id
 * is captured dynamically from the post-create URL (not hard-coded).
 *
 * Infra gating: if the stack is unreachable the test skips cleanly, mirroring
 * the repo's DB-gated tests, so the unit suite stays green.
 */
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3001';
const SNAPSHOT_ID = 'snap-e2e-001';
const GRANT_IDS = ['grant-001', 'grant-002', 'grant-003', 'grant-004'] as const;
const DECISION_ACTIONS = ['approve', 'revoke', 'exception', 'needs_follow_up'] as const;
const REVIEWER_USER_ID = '22222222-2222-4222-8222-222222222222';

interface FinalizeResponse {
  readonly contentHash: string;
  readonly created: boolean;
}

let stackReachable = false;

test.beforeAll(async () => {
  try {
    const response = await fetch(`${API_BASE}/health`);
    stackReachable = response.ok;
  } catch {
    stackReachable = false;
  }
});

test.describe.serial('UAR full access-review flow', () => {
  test('create -> ingest -> review decisions -> finalize -> CSV export', async ({
    page,
    request,
  }) => {
    test.skip(
      !stackReachable,
      `UAR stack not reachable at ${API_BASE}; skipping e2e (boot the api server + web via playwright webServer).`,
    );

    // ── 1. Create a campaign on a frozen snapshot ─────────────────────────────
    await page.goto('/campaigns');
    await page.getByTestId('create-campaign-btn').click();
    await expect(page).toHaveURL(/\/campaigns\/new$/);

    await page.getByTestId('name-input').fill('E2E Access Review');
    await page.getByTestId('snapshot-id-input').fill(SNAPSHOT_ID);
    await page.getByTestId('starts-at-input').fill('2026-01-05');
    await page.getByTestId('due-at-input').fill('2026-02-05');
    await page.getByTestId('submit-btn').click();

    // The server assigns a UUID campaign id; capture it from the redirect URL.
    await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const campaignId = page.url().split('/').pop() ?? '';
    expect(campaignId).toMatch(/^[0-9a-f-]{36}$/);

    // ── 2. Activate the campaign ──────────────────────────────────────────────
    await page.getByTestId('activate-btn').click();
    await expect(page.getByTestId('ingest-btn')).toBeVisible();

    // ── 3. Ingest the CSV → materialize → generate review items ───────────────
    await page.getByTestId('ingest-btn').click();
    await expect(page.getByTestId('review-item-row')).toHaveCount(GRANT_IDS.length);

    // ── 4. Reviewer opens their assignments ───────────────────────────────────
    await page.goto('/review');
    await expect(page.getByTestId('assigned-campaign-row')).toHaveCount(1);
    await page.getByTestId('review-campaign-btn').first().click();
    await expect(page).toHaveURL(new RegExp(`/review/${campaignId}$`));

    const decideLinks = page.getByTestId('decide-item-btn');
    await expect(decideLinks).toHaveCount(GRANT_IDS.length);

    const itemUrls: string[] = [];
    const linkCount = await decideLinks.count();
    for (let index = 0; index < linkCount; index += 1) {
      const href = await decideLinks.nth(index).getAttribute('href');
      if (href !== null) {
        itemUrls.push(href);
      }
    }
    expect(itemUrls).toHaveLength(GRANT_IDS.length);

    // ── 5. Submit one decision per item, covering all four actions ────────────
    for (const [index, itemUrl] of itemUrls.entries()) {
      const action = DECISION_ACTIONS[index % DECISION_ACTIONS.length];
      await page.goto(itemUrl);
      await page.getByTestId(`decision-${action}-btn`).click();
      await page.getByTestId('decision-note-input').fill(`e2e ${action} justification`);
      await page.getByTestId('decision-submit-btn').click();
      await expect(page.getByRole('status')).toContainText('Decision submitted');
    }

    // ── 6. Finalize via the admin UI ──────────────────────────────────────────
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.getByTestId('finalize-btn')).toBeVisible();
    await page.getByTestId('finalize-btn').click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/finalize$`));
    await page.getByTestId('finalize-submit-btn').click();
    await expect(page.getByTestId('download-csv-btn')).toBeVisible();

    // ── 7. Reproducible content hash: re-finalize is idempotent ───────────────
    const firstFinalize = await request.post(`${API_BASE}/campaigns/${campaignId}/finalize`);
    expect(firstFinalize.ok()).toBeTruthy();
    const firstBody = (await firstFinalize.json()) as FinalizeResponse;

    const secondFinalize = await request.post(`${API_BASE}/campaigns/${campaignId}/finalize`);
    expect(secondFinalize.ok()).toBeTruthy();
    const secondBody = (await secondFinalize.json()) as FinalizeResponse;

    expect(firstBody.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondBody.contentHash).toBe(firstBody.contentHash);

    // ── 8. Download the CSV evidence and verify its contents ──────────────────
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-csv-btn').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();

    const csv = readFileSync(String(downloadPath), 'utf8');
    expect(csv).toContain('section,recordJson');
    for (const section of ['node,', 'edge,', 'decision,', 'assignment,']) {
      expect(csv).toContain(section);
    }
    for (const grantId of GRANT_IDS) {
      expect(csv).toContain(grantId);
    }
    for (const action of DECISION_ACTIONS) {
      expect(csv).toContain(action);
    }
    expect(csv).toContain(REVIEWER_USER_ID);
    expect(csv).toContain('has_grant');
  });
});
