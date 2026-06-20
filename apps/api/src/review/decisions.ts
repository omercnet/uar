import { applyReviewDecision, type ReviewDecisionAction } from '@uar/core';

import type { ReviewItemRecord } from './items.js';

type CoreReviewDecision = Parameters<typeof applyReviewDecision>[1];

export interface RecordReviewDecisionInput {
  readonly item: ReviewItemRecord;
  readonly decisionId: string;
  readonly reviewerUserId: string;
  readonly decision: ReviewDecisionAction;
  readonly decidedAt: string;
  readonly note: string;
  readonly store: ReviewDecisionStore;
}

export interface RecordedReviewDecision {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly campaignId: string;
  readonly reviewItemId: string;
  readonly reviewerUserId: string;
  readonly decision: ReviewDecisionAction;
  readonly decidedAt: string;
  readonly note: string;
  readonly item: ReviewItemRecord;
}

export interface ReviewDecisionStore {
  save(decision: RecordedReviewDecision): void;
  get(decisionId: string): RecordedReviewDecision | undefined;
}

export class InMemoryReviewDecisionStore implements ReviewDecisionStore {
  private readonly decisions = new Map<string, RecordedReviewDecision>();

  save(decision: RecordedReviewDecision): void {
    this.decisions.set(decision.decisionId, decision);
  }

  get(decisionId: string): RecordedReviewDecision | undefined {
    return this.decisions.get(decisionId);
  }
}

export function recordReviewDecision(input: RecordReviewDecisionInput): RecordedReviewDecision {
  const decision = {
    tenantId: input.item.tenantId,
    decisionId: input.decisionId,
    campaignId: input.item.campaignId,
    reviewItemId: input.item.reviewItemId,
    reviewerUserId: input.reviewerUserId,
    decision: input.decision,
    decidedAt: input.decidedAt,
    note: input.note,
  } satisfies CoreReviewDecision;
  const item = applyReviewDecision(input.item, decision);
  const recordedDecision = {
    ...decision,
    item,
  } satisfies RecordedReviewDecision;

  input.store.save(recordedDecision);

  return recordedDecision;
}
