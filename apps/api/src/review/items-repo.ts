import { ReviewItemSchema, type ReviewItem } from '@uar/core';
import { and, count as drizzleCount, eq } from 'drizzle-orm';

import { reviewAssignments, reviewItems } from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';
import type { ReviewItemRecord } from './items.js';

export type InsertItemsAndAssignmentsInput = {
  readonly campaignId: string;
  readonly snapshotId: string;
  readonly reviewerUserId: string;
  readonly items: readonly ReviewItemRecord[];
};

type ReviewItemRow = typeof reviewItems.$inferSelect;

export async function insertItemsAndAssignments(
  tx: TenantDb,
  tenantId: string,
  input: InsertItemsAndAssignmentsInput,
): Promise<void> {
  if (input.items.length === 0) {
    return;
  }

  const itemRows = input.items.map((item) => ({
    id: item.reviewItemId,
    tenantId,
    campaignId: input.campaignId,
    snapshotId: input.snapshotId,
    accessGrantId: item.accessGrantId,
    applicationId: item.applicationId,
    externalAccountId: item.externalAccountId,
    status: 'assigned' as const,
  }));
  const assignedAt = new Date();

  await tx
    .insert(reviewItems)
    .values(itemRows)
    .onConflictDoNothing({
      target: [reviewItems.tenantId, reviewItems.campaignId, reviewItems.accessGrantId],
    });

  await tx
    .insert(reviewAssignments)
    .values(
      input.items.map((item) => ({
        id: item.reviewItemId,
        tenantId,
        campaignId: input.campaignId,
        reviewItemId: item.reviewItemId,
        reviewerUserId: input.reviewerUserId,
        status: 'assigned',
        assignedAt,
      })),
    )
    .onConflictDoNothing({ target: [reviewAssignments.tenantId, reviewAssignments.id] });
}

export async function listCampaignItems(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
): Promise<readonly ReviewItem[]> {
  const rows = await tx
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.tenantId, tenantId), eq(reviewItems.campaignId, campaignId)))
    .orderBy(reviewItems.createdAt, reviewItems.id);

  return rows.map(reviewItemFromRow);
}

export async function getCampaignItem(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
  itemId: string,
): Promise<ReviewItem | undefined> {
  const [row] = await tx
    .select()
    .from(reviewItems)
    .where(
      and(eq(reviewItems.tenantId, tenantId), eq(reviewItems.campaignId, campaignId), eq(reviewItems.id, itemId)),
    )
    .limit(1);

  return row === undefined ? undefined : reviewItemFromRow(row);
}

export async function listItemsAssignedTo(
  tx: TenantDb,
  tenantId: string,
  userId: string,
): Promise<readonly ReviewItem[]> {
  const rows = await tx
    .select({ item: reviewItems })
    .from(reviewAssignments)
    .innerJoin(
      reviewItems,
      and(eq(reviewItems.tenantId, reviewAssignments.tenantId), eq(reviewItems.id, reviewAssignments.reviewItemId)),
    )
    .where(and(eq(reviewAssignments.tenantId, tenantId), eq(reviewAssignments.reviewerUserId, userId)))
    .orderBy(reviewItems.createdAt, reviewItems.id);

  return rows.map((row) => reviewItemFromRow(row.item));
}

export async function listCampaignsAssignedTo(
  tx: TenantDb,
  tenantId: string,
  userId: string,
): Promise<readonly string[]> {
  const rows = await tx
    .selectDistinct({ campaignId: reviewAssignments.campaignId })
    .from(reviewAssignments)
    .where(and(eq(reviewAssignments.tenantId, tenantId), eq(reviewAssignments.reviewerUserId, userId)))
    .orderBy(reviewAssignments.campaignId);

  return rows.map((row) => row.campaignId);
}

export async function countItems(tx: TenantDb, tenantId: string, campaignId: string): Promise<number> {
  const [row] = await tx
    .select({ value: drizzleCount() })
    .from(reviewItems)
    .where(and(eq(reviewItems.tenantId, tenantId), eq(reviewItems.campaignId, campaignId)));

  return row?.value ?? 0;
}

function reviewItemFromRow(row: ReviewItemRow): ReviewItem {
  return ReviewItemSchema.parse({
    tenantId: row.tenantId,
    reviewItemId: row.id,
    campaignId: row.campaignId,
    snapshotId: row.snapshotId,
    accessGrantId: row.accessGrantId,
    applicationId: row.applicationId,
    externalAccountId: row.externalAccountId,
    status: row.status,
    suggestedReviewerUserIds: [],
    createdAt: row.createdAt.toISOString(),
    ...(row.decisionId === null ? {} : { decisionId: row.decisionId }),
  });
}
