import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabaseClient, getDatabaseUrl } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';
import {
  accessGrants,
  applications,
  externalAccounts,
  ingestionRuns,
  reviewCampaigns,
  reviewDecisions,
  reviewItems,
  snapshots,
  tenants,
  userIdentities,
} from '../db/schema/index.js';
import { canConnect, resetUarDatabase } from '../db/test-support.js';
import { type TenantDb, withTenantTransaction } from '../db/tenant-context.js';
import { applyDecisionAndPersist, listDecisions } from './decisions-repo.js';
import type { ReviewItemRecord } from './items.js';

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

const fixture = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  applicationId: '22222222-2222-4222-8222-222222222222',
  userIdentityId: '33333333-3333-4333-8333-333333333333',
  ingestionRunId: '44444444-4444-4444-8444-444444444444',
  externalAccountId: '55555555-5555-4555-8555-555555555555',
  accessGrantId: '66666666-6666-4666-8666-666666666666',
  snapshotId: '77777777-7777-4777-8777-777777777777',
  campaignId: '88888888-8888-4888-8888-888888888888',
  reviewItemId: '99999999-9999-4999-8999-999999999999',
  firstDecisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  secondDecisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

async function prepareMigratedDatabase(): Promise<ReturnType<typeof createDatabaseClient>> {
  await resetUarDatabase(databaseUrl);
  await migrateDatabase({ databaseUrl });

  return createDatabaseClient(databaseUrl, { max: 1 });
}

async function seedReviewItem(tx: TenantDb): Promise<ReviewItemRecord> {
  await tx.insert(tenants).values({ tenantId: fixture.tenantId, slug: 'decisions-repo', name: 'Decisions Repo' });
  await tx.insert(applications).values({
    id: fixture.applicationId,
    tenantId: fixture.tenantId,
    key: 'directory',
    name: 'Directory',
    connectorId: 'manual-csv',
  });
  await tx.insert(userIdentities).values({
    id: fixture.userIdentityId,
    tenantId: fixture.tenantId,
    primaryEmail: 'reviewer@example.test',
    displayName: 'Reviewer',
  });
  await tx.insert(ingestionRuns).values({
    id: fixture.ingestionRunId,
    tenantId: fixture.tenantId,
    connectorId: 'manual-csv',
    status: 'completed',
  });
  await tx.insert(externalAccounts).values({
    id: fixture.externalAccountId,
    tenantId: fixture.tenantId,
    applicationId: fixture.applicationId,
    userIdentityId: fixture.userIdentityId,
    externalId: 'external-1',
    displayName: 'External Account',
  });
  await tx.insert(accessGrants).values({
    id: fixture.accessGrantId,
    tenantId: fixture.tenantId,
    applicationId: fixture.applicationId,
    externalAccountId: fixture.externalAccountId,
    userIdentityId: fixture.userIdentityId,
    grantType: 'role',
    grantValue: 'admin',
    source: 'fixture',
  });
  await tx.insert(snapshots).values({
    id: fixture.snapshotId,
    tenantId: fixture.tenantId,
    connectorId: 'manual-csv',
    ingestionRunId: fixture.ingestionRunId,
    lifecycle: 'frozen',
    manifest: { schemaVersion: '1' },
  });
  await tx.insert(reviewCampaigns).values({
    id: fixture.campaignId,
    tenantId: fixture.tenantId,
    snapshotId: fixture.snapshotId,
    name: 'Quarterly review',
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    dueAt: new Date('2026-02-01T00:00:00.000Z'),
  });
  await tx.insert(reviewItems).values({
    id: fixture.reviewItemId,
    tenantId: fixture.tenantId,
    campaignId: fixture.campaignId,
    snapshotId: fixture.snapshotId,
    accessGrantId: fixture.accessGrantId,
    applicationId: fixture.applicationId,
    externalAccountId: fixture.externalAccountId,
    status: 'assigned',
  });

  return {
    tenantId: fixture.tenantId,
    reviewItemId: fixture.reviewItemId,
    campaignId: fixture.campaignId,
    snapshotId: fixture.snapshotId,
    accessGrantId: fixture.accessGrantId,
    applicationId: fixture.applicationId,
    externalAccountId: fixture.externalAccountId,
    status: 'assigned',
    suggestedReviewerUserIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('review decisions repository', () => {
  it.skipIf(!databaseReachable)('persists decisions, updates item status, and re-decides in place', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();

    try {
      await withTenantTransaction(db, fixture.tenantId, async (tx) => {
        const item = await seedReviewItem(tx);

        // When
        const firstDecision = await applyDecisionAndPersist(tx, fixture.tenantId, {
          item,
          decision: {
            decisionId: fixture.firstDecisionId,
            reviewerUserId: fixture.userIdentityId,
            decision: 'approve',
            decidedAt: '2026-01-03T00:00:00.000Z',
            note: 'Looks good.',
          },
        });
        const secondDecision = await applyDecisionAndPersist(tx, fixture.tenantId, {
          item: firstDecision.item,
          decision: {
            decisionId: fixture.secondDecisionId,
            reviewerUserId: fixture.userIdentityId,
            decision: 'approve',
            decidedAt: '2026-01-04T00:00:00.000Z',
            note: 'Still approved.',
          },
        });

        // Then
        const [updatedItem] = await tx
          .select({ status: reviewItems.status, decisionId: reviewItems.decisionId })
          .from(reviewItems)
          .where(and(eq(reviewItems.tenantId, fixture.tenantId), eq(reviewItems.id, fixture.reviewItemId)))
          .limit(1);
        const rows = await tx.select({ id: reviewDecisions.id, note: reviewDecisions.note }).from(reviewDecisions);
        const decisions = await listDecisions(tx, fixture.tenantId, fixture.campaignId);

        expect(secondDecision.item.status).toBe('approved');
        expect(updatedItem).toEqual({ status: 'approved', decisionId: fixture.secondDecisionId });
        expect(rows).toEqual([{ id: fixture.secondDecisionId, note: 'Still approved.' }]);
        expect(decisions.map((decision) => decision.decisionId)).toEqual([fixture.secondDecisionId]);
      });
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
