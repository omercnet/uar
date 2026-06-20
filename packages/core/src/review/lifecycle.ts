import { z } from 'zod';

import type { SnapshotLifecycle } from '../snapshot/lifecycle.js';

export const REVIEW_CAMPAIGN_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
export const REVIEW_ITEM_STATUSES = [
  'pending',
  'assigned',
  'approved',
  'revoked',
  'exception',
  'needs_follow_up',
] as const;
export const REVIEW_DECISION_ACTIONS = ['approve', 'revoke', 'exception', 'needs_follow_up'] as const;

const IsoTimestampSchema = z.iso.datetime();
const NonEmptyStringSchema = z.string().min(1);

export const ReviewCampaignStatusSchema = z.enum(REVIEW_CAMPAIGN_STATUSES);
export type ReviewCampaignStatus = z.infer<typeof ReviewCampaignStatusSchema>;

export const ReviewItemStatusSchema = z.enum(REVIEW_ITEM_STATUSES);
export type ReviewItemStatus = z.infer<typeof ReviewItemStatusSchema>;

export const ReviewDecisionActionSchema = z.enum(REVIEW_DECISION_ACTIONS);
export type ReviewDecisionAction = z.infer<typeof ReviewDecisionActionSchema>;

export const ReviewCampaignSchema = z.object({
  tenantId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  snapshotId: NonEmptyStringSchema,
  snapshotLifecycle: z.literal('frozen'),
  status: ReviewCampaignStatusSchema,
  startsAt: IsoTimestampSchema,
  dueAt: IsoTimestampSchema,
  createdAt: IsoTimestampSchema,
});
export type ReviewCampaign = z.infer<typeof ReviewCampaignSchema>;

export const ReviewItemSchema = z.object({
  tenantId: NonEmptyStringSchema,
  reviewItemId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  snapshotId: NonEmptyStringSchema,
  accessGrantId: NonEmptyStringSchema,
  applicationId: NonEmptyStringSchema,
  externalAccountId: NonEmptyStringSchema,
  status: ReviewItemStatusSchema,
  decisionId: NonEmptyStringSchema.optional(),
  suggestedReviewerUserIds: z.array(NonEmptyStringSchema).readonly(),
  createdAt: IsoTimestampSchema,
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const ReviewDecisionSchema = z.object({
  tenantId: NonEmptyStringSchema,
  decisionId: NonEmptyStringSchema,
  campaignId: NonEmptyStringSchema,
  reviewItemId: NonEmptyStringSchema,
  reviewerUserId: NonEmptyStringSchema,
  decision: ReviewDecisionActionSchema,
  decidedAt: IsoTimestampSchema,
  note: z.string(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export interface SuggestedReviewersInput {
  readonly accessGrantOwnerUserId?: string;
  readonly applicationOwnerUserId?: string;
  readonly externalAccountManagerUserId?: string;
}

export class ReviewSnapshotLifecycleError extends Error {
  override readonly name = 'ReviewSnapshotLifecycleError';

  constructor(readonly lifecycle: SnapshotLifecycle) {
    super(`Review campaigns require a frozen snapshot, received ${lifecycle}`);
  }
}

export class ReviewLifecycleTransitionError extends Error {
  override readonly name = 'ReviewLifecycleTransitionError';

  constructor(
    readonly entity: 'campaign' | 'item',
    readonly from: ReviewCampaignStatus | ReviewItemStatus,
    readonly to: ReviewCampaignStatus | ReviewItemStatus,
  ) {
    super(`Invalid review ${entity} transition: ${from} → ${to}`);
  }
}

export class ReviewDecisionMismatchError extends Error {
  override readonly name = 'ReviewDecisionMismatchError';

  constructor(readonly field: 'tenantId' | 'campaignId' | 'reviewItemId') {
    super(`Review decision does not match item ${field}`);
  }
}

class UnexpectedReviewVariantError extends Error {
  override readonly name = 'UnexpectedReviewVariantError';

  constructor(readonly value: never) {
    super(`Unexpected review variant: ${JSON.stringify(value)}`);
  }
}

const allowedCampaignTransitions: Record<ReviewCampaignStatus, readonly ReviewCampaignStatus[]> = {
  draft: ['draft', 'active', 'cancelled'],
  active: ['active', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

const allowedItemTransitions: Record<ReviewItemStatus, readonly ReviewItemStatus[]> = {
  pending: ['pending', 'assigned'],
  assigned: ['assigned', 'approved', 'revoked', 'exception', 'needs_follow_up'],
  approved: ['approved'],
  revoked: ['revoked'],
  exception: ['exception'],
  needs_follow_up: ['needs_follow_up', 'assigned'],
};

export function assertReviewCampaignSnapshotFrozen(
  lifecycle: SnapshotLifecycle,
): Extract<SnapshotLifecycle, 'frozen'> {
  if (lifecycle !== 'frozen') {
    throw new ReviewSnapshotLifecycleError(lifecycle);
  }

  return lifecycle;
}

export function isAllowedReviewCampaignTransition(
  from: ReviewCampaignStatus,
  to: ReviewCampaignStatus,
): boolean {
  return allowedCampaignTransitions[from].includes(to);
}

export function assertReviewCampaignTransition(
  from: ReviewCampaignStatus,
  to: ReviewCampaignStatus,
): void {
  if (!isAllowedReviewCampaignTransition(from, to)) {
    throw new ReviewLifecycleTransitionError('campaign', from, to);
  }
}

export function isAllowedReviewItemTransition(from: ReviewItemStatus, to: ReviewItemStatus): boolean {
  return allowedItemTransitions[from].includes(to);
}

export function assertReviewItemTransition(from: ReviewItemStatus, to: ReviewItemStatus): void {
  if (!isAllowedReviewItemTransition(from, to)) {
    throw new ReviewLifecycleTransitionError('item', from, to);
  }
}

export function applyReviewDecision(item: ReviewItem, decision: ReviewDecision): ReviewItem {
  assertDecisionMatchesItem(item, decision);

  const nextStatus = reviewDecisionStatus(decision.decision);
  assertReviewItemTransition(item.status, nextStatus);

  return ReviewItemSchema.parse({
    ...item,
    status: nextStatus,
    decisionId: decision.decisionId,
  });
}

export function suggestReviewers(input: SuggestedReviewersInput): readonly string[] {
  const reviewerIds: string[] = [];

  addReviewer(reviewerIds, input.accessGrantOwnerUserId);
  addReviewer(reviewerIds, input.applicationOwnerUserId);
  addReviewer(reviewerIds, input.externalAccountManagerUserId);

  return reviewerIds;
}

function assertDecisionMatchesItem(item: ReviewItem, decision: ReviewDecision): void {
  if (decision.tenantId !== item.tenantId) {
    throw new ReviewDecisionMismatchError('tenantId');
  }

  if (decision.campaignId !== item.campaignId) {
    throw new ReviewDecisionMismatchError('campaignId');
  }

  if (decision.reviewItemId !== item.reviewItemId) {
    throw new ReviewDecisionMismatchError('reviewItemId');
  }
}

function reviewDecisionStatus(action: ReviewDecisionAction): ReviewItemStatus {
  switch (action) {
    case 'approve':
      return 'approved';
    case 'revoke':
      return 'revoked';
    case 'exception':
      return 'exception';
    case 'needs_follow_up':
      return 'needs_follow_up';
    default:
      return assertNever(action);
  }
}

function addReviewer(reviewerIds: string[], reviewerUserId: string | undefined): void {
  if (reviewerUserId === undefined || reviewerIds.includes(reviewerUserId)) {
    return;
  }

  reviewerIds.push(reviewerUserId);
}

function assertNever(value: never): never {
  throw new UnexpectedReviewVariantError(value);
}
