import { applyReviewDecision, type ReviewDecisionAction } from '@uar/core';
import { and, eq } from 'drizzle-orm';

import { reviewDecisions, reviewItems } from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';
import type { ReviewItemRecord } from './items.js';

type CoreReviewDecision = Parameters<typeof applyReviewDecision>[1];
type MaybePromise<Value> = Value | Promise<Value>;

export interface DrizzleReviewDecisionStoreInput {
  readonly tx: TenantDb;
  readonly tenantId: string;
}

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
  save(decision: RecordedReviewDecision): MaybePromise<void>;
  get(decisionId: string): MaybePromise<RecordedReviewDecision | undefined>;
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

export class DrizzleReviewDecisionStore implements ReviewDecisionStore {
  private readonly tx: TenantDb;
  private readonly tenantId: string;

  constructor(input: DrizzleReviewDecisionStoreInput) {
    this.tx = input.tx;
    this.tenantId = input.tenantId;
  }

  async save(decision: RecordedReviewDecision): Promise<void> {
    const decidedAt = new Date(decision.decidedAt);

    await this.tx
      .insert(reviewDecisions)
      .values({
        id: decision.decisionId,
        tenantId: this.tenantId,
        campaignId: decision.campaignId,
        reviewItemId: decision.reviewItemId,
        reviewerUserId: decision.reviewerUserId,
        decision: decision.decision,
        note: decision.note,
        decidedAt,
      })
      .onConflictDoUpdate({
        target: [reviewDecisions.tenantId, reviewDecisions.reviewItemId],
        set: {
          id: decision.decisionId,
          campaignId: decision.campaignId,
          reviewerUserId: decision.reviewerUserId,
          decision: decision.decision,
          note: decision.note,
          decidedAt,
        },
      });
  }

  async get(decisionId: string): Promise<RecordedReviewDecision | undefined> {
    const [decision] = await this.selectDecisions(eq(reviewDecisions.id, decisionId));

    return decision;
  }

  async listByCampaign(campaignId: string): Promise<readonly RecordedReviewDecision[]> {
    return this.selectDecisions(eq(reviewDecisions.campaignId, campaignId));
  }

  private async selectDecisions(predicate: ReturnType<typeof eq>): Promise<RecordedReviewDecision[]> {
    const rows = await this.tx
      .select({
        decisionId: reviewDecisions.id,
        campaignId: reviewDecisions.campaignId,
        reviewItemId: reviewDecisions.reviewItemId,
        reviewerUserId: reviewDecisions.reviewerUserId,
        decision: reviewDecisions.decision,
        decidedAt: reviewDecisions.decidedAt,
        note: reviewDecisions.note,
        snapshotId: reviewItems.snapshotId,
        accessGrantId: reviewItems.accessGrantId,
        applicationId: reviewItems.applicationId,
        externalAccountId: reviewItems.externalAccountId,
        itemStatus: reviewItems.status,
        itemDecisionId: reviewItems.decisionId,
        createdAt: reviewItems.createdAt,
      })
      .from(reviewDecisions)
      .innerJoin(
        reviewItems,
        and(eq(reviewItems.tenantId, reviewDecisions.tenantId), eq(reviewItems.id, reviewDecisions.reviewItemId)),
      )
      .where(and(eq(reviewDecisions.tenantId, this.tenantId), predicate))
      .orderBy(reviewDecisions.decidedAt);

    return rows.map((row) => ({
      tenantId: this.tenantId,
      decisionId: row.decisionId,
      campaignId: row.campaignId,
      reviewItemId: row.reviewItemId,
      reviewerUserId: row.reviewerUserId,
      decision: row.decision,
      decidedAt: row.decidedAt.toISOString(),
      note: row.note,
      item: {
        tenantId: this.tenantId,
        reviewItemId: row.reviewItemId,
        campaignId: row.campaignId,
        snapshotId: row.snapshotId,
        accessGrantId: row.accessGrantId,
        applicationId: row.applicationId,
        externalAccountId: row.externalAccountId,
        status: row.itemStatus,
        decisionId: row.itemDecisionId ?? undefined,
        suggestedReviewerUserIds: [],
        createdAt: row.createdAt.toISOString(),
      },
    }));
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
