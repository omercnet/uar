import { and, asc, eq } from 'drizzle-orm';

import {
  ReviewCampaignSchema,
  SnapshotManifestSchema,
  assertReviewCampaignTransition,
  type ReviewCampaign,
  type ReviewCampaignStatus,
} from '@uar/core';

import { reviewCampaigns, snapshots } from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';

export type CreateCampaignWithSnapshotInput = {
  readonly name: string;
  readonly snapshotId: string;
  readonly startsAt: Date;
  readonly dueAt: Date;
};

type CampaignRow = typeof reviewCampaigns.$inferSelect;

export class CampaignRepositoryMutationError extends Error {
  override readonly name = 'CampaignRepositoryMutationError';

  constructor(readonly operation: 'insert_snapshot' | 'insert_campaign' | 'update_campaign') {
    super(`Review campaign repository ${operation} returned no row`);
  }
}

export async function createCampaignWithSnapshot(
  tx: TenantDb,
  tenantId: string,
  input: CreateCampaignWithSnapshotInput,
): Promise<ReviewCampaign> {
  const createdAt = new Date();
  const manifest = SnapshotManifestSchema.parse({
    snapshotId: input.snapshotId,
    tenantId,
    createdAt: createdAt.toISOString(),
    connectorId: input.snapshotId,
    recordCounts: {},
    schemaVersion: 'placeholder',
  });
  const [snapshotRow] = await tx
    .insert(snapshots)
    .values({ tenantId, connectorId: input.snapshotId, lifecycle: 'building', manifest })
    .returning({ id: snapshots.id });

  if (snapshotRow === undefined) {
    throw new CampaignRepositoryMutationError('insert_snapshot');
  }

  const [campaignRow] = await tx
    .insert(reviewCampaigns)
    .values({
      tenantId,
      snapshotId: snapshotRow.id,
      name: input.name,
      startsAt: input.startsAt,
      dueAt: input.dueAt,
    })
    .returning();

  return mapRequiredCampaign(campaignRow, 'insert_campaign');
}

export async function getCampaign(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
): Promise<ReviewCampaign | undefined> {
  const [row] = await tx
    .select()
    .from(reviewCampaigns)
    .where(and(eq(reviewCampaigns.tenantId, tenantId), eq(reviewCampaigns.id, campaignId)))
    .limit(1);

  return row === undefined ? undefined : mapCampaign(row);
}

export async function listCampaigns(tx: TenantDb, tenantId: string): Promise<ReviewCampaign[]> {
  const rows = await tx
    .select()
    .from(reviewCampaigns)
    .where(eq(reviewCampaigns.tenantId, tenantId))
    .orderBy(asc(reviewCampaigns.createdAt));

  return rows.map(mapCampaign);
}

export async function updateCampaignStatus(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
  status: ReviewCampaignStatus,
): Promise<ReviewCampaign | undefined> {
  const current = await getCampaignRow(tx, tenantId, campaignId);

  if (current === undefined) {
    return undefined;
  }

  assertReviewCampaignTransition(current.status, status);

  return updateCampaignRow(tx, tenantId, campaignId, { status });
}

export async function completeCampaign(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
): Promise<ReviewCampaign | undefined> {
  const current = await getCampaignRow(tx, tenantId, campaignId);

  if (current === undefined) {
    return undefined;
  }

  assertReviewCampaignTransition(current.status, 'completed');

  return updateCampaignRow(tx, tenantId, campaignId, { status: 'completed', completedAt: new Date() });
}

async function getCampaignRow(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
): Promise<CampaignRow | undefined> {
  const [row] = await tx
    .select()
    .from(reviewCampaigns)
    .where(and(eq(reviewCampaigns.tenantId, tenantId), eq(reviewCampaigns.id, campaignId)))
    .limit(1);

  return row;
}

async function updateCampaignRow(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
  values: Pick<CampaignRow, 'status'> & Partial<Pick<CampaignRow, 'completedAt'>>,
): Promise<ReviewCampaign> {
  const [row] = await tx
    .update(reviewCampaigns)
    .set(values)
    .where(and(eq(reviewCampaigns.tenantId, tenantId), eq(reviewCampaigns.id, campaignId)))
    .returning();

  return mapRequiredCampaign(row, 'update_campaign');
}

function mapRequiredCampaign(
  row: CampaignRow | undefined,
  operation: CampaignRepositoryMutationError['operation'],
): ReviewCampaign {
  if (row === undefined) {
    throw new CampaignRepositoryMutationError(operation);
  }

  return mapCampaign(row);
}

function mapCampaign(row: CampaignRow): ReviewCampaign {
  return ReviewCampaignSchema.parse({
    tenantId: row.tenantId,
    campaignId: row.id,
    name: row.name,
    snapshotId: row.snapshotId,
    snapshotLifecycle: 'frozen',
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}
