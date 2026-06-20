import { assertReviewItemTransition, suggestReviewers, type ReviewItemStatus } from '@uar/core';

import type { ReviewCampaignRecord } from './campaign.js';

export interface ReviewItemAccessGrantInput {
  readonly accessGrantId: string;
  readonly applicationId: string;
  readonly externalAccountId: string;
  readonly accessGrantOwnerUserId?: string;
  readonly applicationOwnerUserId?: string;
  readonly externalAccountManagerUserId?: string;
}

export interface GenerateReviewItemsInput {
  readonly campaign: ReviewCampaignRecord;
  readonly snapshotId: string;
  readonly accessGrants: readonly ReviewItemAccessGrantInput[];
  readonly createdAt: string;
  readonly createReviewItemId: () => string;
}

export interface ReviewItemRecord {
  readonly tenantId: string;
  readonly reviewItemId: string;
  readonly campaignId: string;
  readonly snapshotId: string;
  readonly accessGrantId: string;
  readonly applicationId: string;
  readonly externalAccountId: string;
  readonly status: ReviewItemStatus;
  readonly decisionId?: string;
  readonly suggestedReviewerUserIds: readonly string[];
  readonly createdAt: string;
}

export class ReviewSnapshotMismatchError extends Error {
  override readonly name = 'ReviewSnapshotMismatchError';

  constructor(
    readonly campaignSnapshotId: string,
    readonly requestedSnapshotId: string,
  ) {
    super(`Review items must be generated from campaign snapshot ${campaignSnapshotId}`);
  }
}

export function generateReviewItems(input: GenerateReviewItemsInput): readonly ReviewItemRecord[] {
  if (input.snapshotId !== input.campaign.snapshotId) {
    throw new ReviewSnapshotMismatchError(input.campaign.snapshotId, input.snapshotId);
  }

  return input.accessGrants.map((accessGrant) => ({
    tenantId: input.campaign.tenantId,
    reviewItemId: input.createReviewItemId(),
    campaignId: input.campaign.campaignId,
    snapshotId: input.campaign.snapshotId,
    accessGrantId: accessGrant.accessGrantId,
    applicationId: accessGrant.applicationId,
    externalAccountId: accessGrant.externalAccountId,
    status: 'pending',
    suggestedReviewerUserIds: suggestReviewers(accessGrant),
    createdAt: input.createdAt,
  }));
}

export function markReviewItemAssigned(item: ReviewItemRecord): ReviewItemRecord {
  assertReviewItemTransition(item.status, 'assigned');

  return {
    ...item,
    status: 'assigned',
  };
}
