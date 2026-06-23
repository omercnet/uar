import { createServer, type Server } from 'node:http';

import { finalizeSnapshotManifest, type TenantContext } from '@uar/core';
import { eq } from 'drizzle-orm';

import { createDatabaseClient, getDatabaseUrl, type DatabaseClient } from '../../db/client.js';
import { migrateDatabase } from '../../db/migrate.js';
import {
  accessGrants,
  applications,
  externalAccounts,
  reviewAssignments,
  reviewCampaigns,
  reviewDecisions,
  reviewItems,
  snapshotNodes,
  snapshots,
  tenants,
  userIdentities,
} from '../../db/schema/index.js';
import { resetUarDatabase } from '../../db/test-support.js';
import { type TenantDb, withTenantTransaction } from '../../db/tenant-context.js';
import { sendJson } from '../http-adapter.js';
import { HttpError, type HandlerContext, type RouteHandler } from '../router.js';

export const fixture = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  campaignId: '22222222-2222-4222-8222-222222222222',
  snapshotId: '33333333-3333-4333-8333-333333333333',
  reviewerUserId: '44444444-4444-4444-8444-444444444444',
  applicationId: '55555555-5555-4555-8555-555555555555',
  accountA: '66666666-6666-4666-8666-666666666666',
  accountB: '77777777-7777-4777-8777-777777777777',
  grantA: '88888888-8888-4888-8888-888888888888',
  grantB: '99999999-9999-4999-8999-999999999999',
  itemA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  itemB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  decisionA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  decisionB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  nodeA: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  nodeB: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
} as const;

const tenantContext = {
  tenantId: fixture.tenantId,
  userId: fixture.reviewerUserId,
  roles: ['admin'],
} satisfies TenantContext;

export type TestServer = {
  readonly server: Server;
  readonly baseUrl: string;
};

export async function prepareMigratedDatabase(): Promise<ReturnType<typeof createDatabaseClient>> {
  await resetUarDatabase(getDatabaseUrl());
  await migrateDatabase({ databaseUrl: getDatabaseUrl() });

  return createDatabaseClient(getDatabaseUrl(), { max: 1 });
}

export async function createHandlerServer(
  handler: RouteHandler,
  db: DatabaseClient,
  campaignId: string,
): Promise<TestServer> {
  const server = createServer((req, res) => {
    const context = {
      tenantContext,
      db,
      req,
      res,
      params: { campaignId },
      url: new URL(req.url ?? '/', 'http://localhost'),
    } satisfies HandlerContext;

    Promise.resolve(handler(context)).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(res, error.status, error.body);
        return;
      }
      throw error;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected test server TCP address');
  }

  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function seedReviewGraph(tx: TenantDb, status: 'active' | 'completed'): Promise<void> {
  await tx.insert(tenants).values({ tenantId: fixture.tenantId, slug: 'finalize-test', name: 'Finalize Test' });
  await tx.insert(userIdentities).values({
    id: fixture.reviewerUserId,
    tenantId: fixture.tenantId,
    primaryEmail: 'reviewer@example.test',
    displayName: 'Reviewer',
  });
  await tx.insert(applications).values({
    id: fixture.applicationId,
    tenantId: fixture.tenantId,
    key: 'github',
    name: 'GitHub',
    connectorId: 'github',
  });
  await tx.insert(snapshots).values({
    id: fixture.snapshotId,
    tenantId: fixture.tenantId,
    connectorId: 'github',
    lifecycle: 'building',
    manifest: {
      snapshotId: fixture.snapshotId,
      tenantId: fixture.tenantId,
      createdAt: '2026-01-01T00:00:00.000Z',
      connectorId: 'github',
      recordCounts: {},
      schemaVersion: '1',
    },
  });
  await tx.insert(reviewCampaigns).values({
    id: fixture.campaignId,
    tenantId: fixture.tenantId,
    snapshotId: fixture.snapshotId,
    name: 'Quarterly review',
    status,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    dueAt: new Date('2026-02-01T00:00:00.000Z'),
  });
  await seedGrant(tx, fixture.accountA, fixture.grantA, fixture.itemA, fixture.nodeA, 'approve');
  await seedGrant(tx, fixture.accountB, fixture.grantB, fixture.itemB, fixture.nodeB, 'revoke');
  await freezeSnapshot(tx);
}

async function seedGrant(
  tx: TenantDb,
  accountId: string,
  grantId: string,
  itemId: string,
  nodeId: string,
  decision: 'approve' | 'revoke',
): Promise<void> {
  await tx.insert(externalAccounts).values({
    id: accountId,
    tenantId: fixture.tenantId,
    applicationId: fixture.applicationId,
    userIdentityId: fixture.reviewerUserId,
    externalId: accountId,
    displayName: accountId,
  });
  await tx.insert(accessGrants).values({
    id: grantId,
    tenantId: fixture.tenantId,
    applicationId: fixture.applicationId,
    externalAccountId: accountId,
    userIdentityId: fixture.reviewerUserId,
    grantType: 'role',
    grantValue: decision,
    source: 'fixture',
  });
  await tx.insert(snapshotNodes).values({
    id: nodeId,
    tenantId: fixture.tenantId,
    snapshotId: fixture.snapshotId,
    nodeType: 'access_grant',
    stableId: grantId,
    label: grantId,
    payload: { grantId, decision },
  });
  await tx.insert(reviewItems).values({
    id: itemId,
    tenantId: fixture.tenantId,
    campaignId: fixture.campaignId,
    snapshotId: fixture.snapshotId,
    accessGrantId: grantId,
    applicationId: fixture.applicationId,
    externalAccountId: accountId,
    status: decision === 'approve' ? 'approved' : 'revoked',
  });
  await tx.insert(reviewAssignments).values({
    id: itemId,
    tenantId: fixture.tenantId,
    campaignId: fixture.campaignId,
    reviewItemId: itemId,
    reviewerUserId: fixture.reviewerUserId,
    status: 'assigned',
    assignedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  await tx.insert(reviewDecisions).values({
    id: decision === 'approve' ? fixture.decisionA : fixture.decisionB,
    tenantId: fixture.tenantId,
    campaignId: fixture.campaignId,
    reviewItemId: itemId,
    reviewerUserId: fixture.reviewerUserId,
    decision,
    note: `${decision} grant`,
    decidedAt: new Date('2026-01-03T00:00:00.000Z'),
  });
}

async function freezeSnapshot(tx: TenantDb): Promise<void> {
  const finalized = finalizeSnapshotManifest({
    snapshotId: fixture.snapshotId,
    tenantId: fixture.tenantId,
    createdAt: '2026-01-01T00:00:00.000Z',
    connectorId: 'github',
    recordCounts: { snapshotNodes: 2 },
    schemaVersion: '1',
  });
  await tx.update(snapshots).set({ lifecycle: 'ready' }).where(eq(snapshots.id, fixture.snapshotId));
  await tx
    .update(snapshots)
    .set({ lifecycle: 'frozen', manifest: finalized.manifest, manifestHash: finalized.manifestHash })
    .where(eq(snapshots.id, fixture.snapshotId));
}

export async function readCampaignStatus(db: DatabaseClient): Promise<string | undefined> {
  return withTenantTransaction(db, fixture.tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: reviewCampaigns.status })
      .from(reviewCampaigns)
      .where(eq(reviewCampaigns.id, fixture.campaignId))
      .limit(1);

    return row?.status;
  });
}
