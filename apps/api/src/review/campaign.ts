import {
  ReviewCampaignStatusSchema,
  assertReviewCampaignSnapshotFrozen,
  type SnapshotLifecycle,
} from '@uar/core';

export interface CreateReviewCampaignInput {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly name: string;
  readonly snapshotId: string;
  readonly snapshotLifecycle: SnapshotLifecycle;
  readonly startsAt: string;
  readonly dueAt: string;
  readonly createdAt: string;
}

export interface ReviewCampaignRecord {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly name: string;
  readonly snapshotId: string;
  readonly snapshotLifecycle: Extract<SnapshotLifecycle, 'frozen'>;
  readonly status: 'draft';
  readonly startsAt: string;
  readonly dueAt: string;
  readonly createdAt: string;
}

export function createReviewCampaign(input: CreateReviewCampaignInput): ReviewCampaignRecord {
  return {
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    name: input.name,
    snapshotId: input.snapshotId,
    snapshotLifecycle: assertReviewCampaignSnapshotFrozen(input.snapshotLifecycle),
    status: ReviewCampaignStatusSchema.extract(['draft']).parse('draft'),
    startsAt: input.startsAt,
    dueAt: input.dueAt,
    createdAt: input.createdAt,
  };
}
