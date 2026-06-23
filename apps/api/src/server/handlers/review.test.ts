import { randomUUID } from 'node:crypto';

import { ReviewCampaignSchema, ReviewDecisionSchema, ReviewItemSchema } from '@uar/core';
import { describe, expect, it } from 'vitest';

import { createDatabaseClient } from '../../db/client.js';
import {
  accessGrants,
  applications,
  externalAccounts,
  reviewAssignments,
  reviewCampaigns,
  reviewItems,
  snapshots,
  tenants,
  userIdentities,
} from '../../db/schema/index.js';
import { resetUarDatabase } from '../../db/test-support.js';
import { withTenantTransaction, type TenantDb } from '../../db/tenant-context.js';
import { decideReviewItemHandler, getReviewCampaignItemsHandler, listReviewCampaignsHandler } from './review.js';
import {
  databaseReachable,
  databaseUrl,
  prepareMigratedDatabase,
  startInjectedServer,
} from './test-support.js';

const tenantId = randomUUID();
const reviewerUserId = randomUUID();
const otherUserId = randomUUID();
const reviewRoutes = [
  { method: 'GET', path: '/review/campaigns', handler: listReviewCampaignsHandler },
  { method: 'GET', path: '/review/campaigns/:campaignId/items', handler: getReviewCampaignItemsHandler },
  { method: 'POST', path: '/review/campaigns/:campaignId/items/:itemId/decide', handler: decideReviewItemHandler },
] as const;

describe('review HTTP handlers', () => {
  it('returns 400 before database access when decision body is invalid', async () => {
    // Given
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1, connect_timeout: 1 });
    const server = await startInjectedServer({
      routes: reviewRoutes,
      db,
      tenantContext: { tenantId, userId: reviewerUserId, roles: ['reviewer'] },
    });

    try {
      // When
      const response = await fetch(`${server.baseUrl}/review/campaigns/${randomUUID()}/items/${randomUUID()}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'invalid', note: 'Nope' }),
      });

      // Then
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'bad_request' });
    } finally {
      await server.close();
      await client.end({ timeout: 1 });
    }
  });

  it.skipIf(!databaseReachable)('returns and decides only work assigned to the caller', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();
    const reviewerServer = await startInjectedServer({
      routes: reviewRoutes,
      db,
      tenantContext: { tenantId, userId: reviewerUserId, roles: ['reviewer'] },
    });

    try {
      const fixture = await withTenantTransaction(db, tenantId, seedAssignedReviewItem);

      // When
      const campaignsResponse = await fetch(`${reviewerServer.baseUrl}/review/campaigns`);
      const itemsResponse = await fetch(`${reviewerServer.baseUrl}/review/campaigns/${fixture.campaignId}/items`);
      const decisionResponse = await fetch(
        `${reviewerServer.baseUrl}/review/campaigns/${fixture.campaignId}/items/${fixture.reviewItemId}/decide`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', note: 'Looks good.' }),
        },
      );
      const otherServer = await startInjectedServer({
        routes: reviewRoutes,
        db,
        tenantContext: { tenantId, userId: otherUserId, roles: ['reviewer'] },
      });
      const otherItemsResponse = await fetch(`${otherServer.baseUrl}/review/campaigns/${fixture.campaignId}/items`);
      await otherServer.close();

      // Then
      expect(ReviewCampaignSchema.array().parse(await campaignsResponse.json())).toHaveLength(1);
      expect(ReviewItemSchema.array().parse(await itemsResponse.json())).toHaveLength(1);
      expect(decisionResponse.status).toBe(200);
      expect(ReviewDecisionSchema.parse(await decisionResponse.json()).decision).toBe('approve');
      expect(ReviewItemSchema.array().parse(await otherItemsResponse.json())).toEqual([]);
    } finally {
      await reviewerServer.close();
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});

async function seedAssignedReviewItem(tx: TenantDb): Promise<{ readonly campaignId: string; readonly reviewItemId: string }> {
  const campaignId = randomUUID();
  const snapshotId = randomUUID();
  const applicationId = randomUUID();
  const externalAccountId = randomUUID();
  const accessGrantId = randomUUID();
  const reviewItemId = randomUUID();

  await tx.insert(tenants).values({ tenantId, slug: 'handlers-review', name: 'Review Handlers' });
  await tx.insert(userIdentities).values([
    { id: reviewerUserId, tenantId, primaryEmail: 'reviewer@example.test', displayName: 'Reviewer' },
    { id: otherUserId, tenantId, primaryEmail: 'other@example.test', displayName: 'Other' },
  ]);
  await tx.insert(applications).values({ id: applicationId, tenantId, key: 'github', name: 'GitHub', connectorId: 'github' });
  await tx.insert(externalAccounts).values({
    id: externalAccountId,
    tenantId,
    applicationId,
    externalId: 'account-1',
    displayName: 'Account 1',
  });
  await tx.insert(accessGrants).values({
    id: accessGrantId,
    tenantId,
    applicationId,
    externalAccountId,
    grantType: 'role',
    grantValue: 'admin',
    source: 'test',
  });
  await tx.insert(snapshots).values({
    id: snapshotId,
    tenantId,
    connectorId: 'github',
    lifecycle: 'building',
    manifest: { schemaVersion: '1' },
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
  await tx.insert(reviewItems).values({
    id: reviewItemId,
    tenantId,
    campaignId,
    snapshotId,
    accessGrantId,
    applicationId,
    externalAccountId,
    status: 'assigned',
  });
  await tx.insert(reviewAssignments).values({
    id: randomUUID(),
    tenantId,
    campaignId,
    reviewItemId,
    reviewerUserId,
    status: 'assigned',
    assignedAt: new Date('2026-01-02T00:00:00.000Z'),
  });

  return { campaignId, reviewItemId };
}
