import { applyReviewDecision, type ReviewDecisionAction } from '@uar/core';
import { and, eq } from 'drizzle-orm';

import { reviewItems } from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';
import { DrizzleReviewDecisionStore, type RecordedReviewDecision } from './decisions.js';
import type { ReviewItemRecord } from './items.js';

export interface PersistReviewDecisionInput {
  readonly decisionId: string;
  readonly reviewerUserId: string;
  readonly decision: ReviewDecisionAction;
  readonly decidedAt: string;
  readonly note: string;
}

export interface ApplyDecisionAndPersistInput {
  readonly item: ReviewItemRecord;
  readonly decision: PersistReviewDecisionInput;
}

export async function applyDecisionAndPersist(
  tx: TenantDb,
  tenantId: string,
  input: ApplyDecisionAndPersistInput,
): Promise<RecordedReviewDecision> {
  const decision = {
    tenantId,
    decisionId: input.decision.decisionId,
    campaignId: input.item.campaignId,
    reviewItemId: input.item.reviewItemId,
    reviewerUserId: input.decision.reviewerUserId,
    decision: input.decision.decision,
    decidedAt: input.decision.decidedAt,
    note: input.decision.note,
  };
  const item = applyReviewDecision(input.item, decision);
  const recordedDecision = {
    ...decision,
    item,
  } satisfies RecordedReviewDecision;
  const store = new DrizzleReviewDecisionStore({ tx, tenantId });

  await store.save(recordedDecision);
  await tx
    .update(reviewItems)
    .set({ decisionId: decision.decisionId, status: item.status })
    .where(and(eq(reviewItems.tenantId, tenantId), eq(reviewItems.id, input.item.reviewItemId)));

  return recordedDecision;
}

export async function listDecisions(
  tx: TenantDb,
  tenantId: string,
  campaignId: string,
): Promise<readonly RecordedReviewDecision[]> {
  const store = new DrizzleReviewDecisionStore({ tx, tenantId });

  return store.listByCampaign(campaignId);
}
