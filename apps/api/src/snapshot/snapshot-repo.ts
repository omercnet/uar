import { FinalizeReviewExportInputSchema, type FinalizeReviewExportInput } from '@uar/reporting';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  reviewAssignments,
  reviewDecisions,
  snapshotEdges,
  snapshotNodes,
} from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';
import type { ReviewCampaignRecord } from '../review/campaign.js';

export async function loadFinalizeInput(
  tx: TenantDb,
  tenantId: string,
  campaign: ReviewCampaignRecord,
): Promise<FinalizeReviewExportInput> {
  const nodes = await loadContentNodes(tx, tenantId, campaign.snapshotId);
  const edges = await loadContentEdges(tx, tenantId, campaign.snapshotId);
  const decisions = await loadReviewDecisions(tx, tenantId, campaign.campaignId);
  const assignments = await loadReviewAssignments(tx, tenantId, campaign.campaignId);

  return FinalizeReviewExportInputSchema.parse({
    tenantId,
    campaignId: campaign.campaignId,
    snapshotId: campaign.snapshotId,
    finalizedAt: new Date().toISOString(),
    nodes,
    edges,
    decisions,
    assignments,
  });
}

async function loadContentNodes(tx: TenantDb, tenantId: string, snapshotId: string) {
  return tx
    .select({
      tenantId: snapshotNodes.tenantId,
      snapshotId: snapshotNodes.snapshotId,
      nodeType: snapshotNodes.nodeType,
      stableId: snapshotNodes.stableId,
      label: snapshotNodes.label,
      payload: snapshotNodes.payload,
    })
    .from(snapshotNodes)
    .where(and(eq(snapshotNodes.tenantId, tenantId), eq(snapshotNodes.snapshotId, snapshotId)))
    .orderBy(asc(snapshotNodes.nodeType), asc(snapshotNodes.stableId));
}

async function loadContentEdges(tx: TenantDb, tenantId: string, snapshotId: string) {
  const sourceNode = alias(snapshotNodes, 'source_node');
  const targetNode = alias(snapshotNodes, 'target_node');

  return tx
    .select({
      tenantId: snapshotEdges.tenantId,
      snapshotId: snapshotEdges.snapshotId,
      sourceNodeStableId: sourceNode.stableId,
      targetNodeStableId: targetNode.stableId,
      edgeType: snapshotEdges.edgeType,
      payload: snapshotEdges.payload,
    })
    .from(snapshotEdges)
    .innerJoin(
      sourceNode,
      and(
        eq(snapshotEdges.tenantId, sourceNode.tenantId),
        eq(snapshotEdges.snapshotId, sourceNode.snapshotId),
        eq(snapshotEdges.sourceNodeId, sourceNode.id),
      ),
    )
    .innerJoin(
      targetNode,
      and(
        eq(snapshotEdges.tenantId, targetNode.tenantId),
        eq(snapshotEdges.snapshotId, targetNode.snapshotId),
        eq(snapshotEdges.targetNodeId, targetNode.id),
      ),
    )
    .where(and(eq(snapshotEdges.tenantId, tenantId), eq(snapshotEdges.snapshotId, snapshotId)))
    .orderBy(asc(sourceNode.stableId), asc(targetNode.stableId), asc(snapshotEdges.edgeType));
}

async function loadReviewDecisions(tx: TenantDb, tenantId: string, campaignId: string) {
  const rows = await tx
    .select({
      tenantId: reviewDecisions.tenantId,
      decisionId: reviewDecisions.id,
      campaignId: reviewDecisions.campaignId,
      reviewItemId: reviewDecisions.reviewItemId,
      reviewerUserId: reviewDecisions.reviewerUserId,
      decision: reviewDecisions.decision,
      decidedAt: reviewDecisions.decidedAt,
      note: reviewDecisions.note,
    })
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.tenantId, tenantId), eq(reviewDecisions.campaignId, campaignId)))
    .orderBy(asc(reviewDecisions.reviewItemId));

  return rows.map((row) => ({ ...row, decidedAt: row.decidedAt.toISOString() }));
}

async function loadReviewAssignments(tx: TenantDb, tenantId: string, campaignId: string) {
  const rows = await tx
    .select({
      tenantId: reviewAssignments.tenantId,
      assignmentId: reviewAssignments.id,
      campaignId: reviewAssignments.campaignId,
      reviewItemId: reviewAssignments.reviewItemId,
      reviewerUserId: reviewAssignments.reviewerUserId,
      status: reviewAssignments.status,
      assignedAt: reviewAssignments.assignedAt,
      dueAt: reviewAssignments.dueAt,
    })
    .from(reviewAssignments)
    .where(and(eq(reviewAssignments.tenantId, tenantId), eq(reviewAssignments.campaignId, campaignId)))
    .orderBy(asc(reviewAssignments.reviewItemId));

  return rows.map((row) => {
    const assignment = {
      tenantId: row.tenantId,
      assignmentId: row.assignmentId,
      campaignId: row.campaignId,
      reviewItemId: row.reviewItemId,
      reviewerUserId: row.reviewerUserId,
      status: row.status,
      assignedAt: row.assignedAt.toISOString(),
    };

    return row.dueAt === null ? assignment : { ...assignment, dueAt: row.dueAt.toISOString() };
  });
}
