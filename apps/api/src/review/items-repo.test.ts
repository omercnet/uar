import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDatabaseClient, getDatabaseUrl } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';
import {
  accessGrants,
  applications,
  externalAccounts,
  reviewCampaigns,
  snapshots,
  tenants,
  userIdentities,
} from '../db/schema/index.js';
import { canConnect, resetUarDatabase } from '../db/test-support.js';
import { type TenantDb, withTenantTransaction } from '../db/tenant-context.js';
import { beginSnapshotBuild } from '../snapshot/lifecycle.js';
import { countItems, insertItemsAndAssignments, listCampaignsAssignedTo } from './items-repo.js';

type SeededReviewGraph = {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly snapshotId: string;
  readonly reviewerUserId: string;
  readonly items: readonly SeedReviewItem[];
};

type SeedReviewItem = {
  readonly tenantId: string;
  readonly reviewItemId: string;
  readonly campaignId: string;
  readonly snapshotId: string;
  readonly accessGrantId: string;
  readonly applicationId: string;
  readonly externalAccountId: string;
  readonly status: 'pending';
  readonly suggestedReviewerUserIds: readonly string[];
  readonly createdAt: string;
};

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

async function prepareMigratedDatabase(): Promise<ReturnType<typeof createDatabaseClient>> {
  await resetUarDatabase(databaseUrl);
  await migrateDatabase({ databaseUrl });

  return createDatabaseClient(databaseUrl, { max: 1 });
}

async function seedReviewGraph(tx: TenantDb, tenantId: string): Promise<SeededReviewGraph> {
  const campaignId = randomUUID();
  const snapshotId = randomUUID();
  const reviewerUserId = randomUUID();
  const applicationId = randomUUID();

  await tx.insert(tenants).values({ tenantId, slug: `tenant-${tenantId}`, name: 'Review Repo Tenant' });
  await tx.insert(userIdentities).values({
    id: reviewerUserId,
    tenantId,
    primaryEmail: 'reviewer@example.test',
    displayName: 'Reviewer',
  });
  await tx.insert(applications).values({
    id: applicationId,
    tenantId,
    key: 'github',
    name: 'GitHub',
    connectorId: 'github',
  });

  const snapshot = beginSnapshotBuild(
    { tenantId, connectorId: 'github', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: '1' },
    { createSnapshotId: () => snapshotId },
  );
  await tx.insert(snapshots).values({
    id: snapshot.id,
    tenantId,
    connectorId: snapshot.connectorId,
    lifecycle: snapshot.lifecycle,
    manifest: snapshot.manifest,
  });
  await tx.insert(reviewCampaigns).values({
    id: campaignId,
    tenantId,
    snapshotId,
    name: 'Q1 Access Review',
    status: 'active',
    startsAt: new Date('2026-01-02T00:00:00.000Z'),
    dueAt: new Date('2026-01-31T00:00:00.000Z'),
  });

  const items = await seedGrants(tx, { tenantId, campaignId, snapshotId, applicationId, reviewerUserId });

  return { tenantId, campaignId, snapshotId, reviewerUserId, items };
}

type GrantSeedInput = {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly snapshotId: string;
  readonly applicationId: string;
  readonly reviewerUserId: string;
};

async function seedGrants(tx: TenantDb, input: GrantSeedInput): Promise<readonly SeedReviewItem[]> {
  const seededItems: SeedReviewItem[] = [];

  for (let index = 0; index < 4; index += 1) {
    const externalAccountId = randomUUID();
    const accessGrantId = randomUUID();

    await tx.insert(externalAccounts).values({
      id: externalAccountId,
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      externalId: `account-${index}`,
      displayName: `Account ${index}`,
    });
    await tx.insert(accessGrants).values({
      id: accessGrantId,
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      externalAccountId,
      grantType: 'role',
      grantValue: `role-${index}`,
      source: 'test',
    });

    seededItems.push({
      tenantId: input.tenantId,
      reviewItemId: randomUUID(),
      campaignId: input.campaignId,
      snapshotId: input.snapshotId,
      accessGrantId,
      applicationId: input.applicationId,
      externalAccountId,
      status: 'pending',
      suggestedReviewerUserIds: [input.reviewerUserId],
      createdAt: '2026-01-02T00:00:00.000Z',
    });
  }

  return seededItems;
}

describe('review items repository', () => {
  it.skipIf(!databaseReachable)('inserts assigned items idempotently and lists assigned campaigns', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();

    try {
      const tenantId = randomUUID();
      const result = await withTenantTransaction(db, tenantId, async (tx) => {
        const graph = await seedReviewGraph(tx, tenantId);

        // When
        await insertItemsAndAssignments(tx, graph.tenantId, {
          campaignId: graph.campaignId,
          snapshotId: graph.snapshotId,
          reviewerUserId: graph.reviewerUserId,
          items: graph.items,
        });
        const firstCount = await countItems(tx, graph.tenantId, graph.campaignId);
        const campaignIds = await listCampaignsAssignedTo(tx, graph.tenantId, graph.reviewerUserId);
        await insertItemsAndAssignments(tx, graph.tenantId, {
          campaignId: graph.campaignId,
          snapshotId: graph.snapshotId,
          reviewerUserId: graph.reviewerUserId,
          items: graph.items,
        });
        const secondCount = await countItems(tx, graph.tenantId, graph.campaignId);

        return { campaignId: graph.campaignId, firstCount, campaignIds, secondCount };
      });

      // Then
      expect(result.firstCount).toBe(4);
      expect(result.campaignIds).toEqual([result.campaignId]);
      expect(result.secondCount).toBe(4);
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
