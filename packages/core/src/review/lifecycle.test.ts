import { describe, expect, it } from 'vitest';

import {
  REVIEW_DECISION_ACTIONS,
  REVIEW_ITEM_STATUSES,
  ReviewCampaignSchema,
  type ReviewDecision,
  type ReviewDecisionAction,
  type ReviewItem,
  type ReviewItemStatus,
  applyReviewDecision,
  assertReviewCampaignSnapshotFrozen,
  assertReviewCampaignTransition,
  assertReviewItemTransition,
  isAllowedReviewCampaignTransition,
  isAllowedReviewItemTransition,
  suggestReviewers,
} from './lifecycle.js';

const frozenCampaign = {
  tenantId: 'tenant-1',
  campaignId: 'campaign-1',
  name: 'Q1 Access Review',
  snapshotId: 'snapshot-frozen-1',
  snapshotLifecycle: 'frozen',
  status: 'draft',
  startsAt: '2026-01-02T03:04:05.000Z',
  dueAt: '2026-01-31T03:04:05.000Z',
  createdAt: '2026-01-01T03:04:05.000Z',
};

const assignedItem = {
  tenantId: 'tenant-1',
  reviewItemId: 'review-item-1',
  campaignId: 'campaign-1',
  snapshotId: 'snapshot-frozen-1',
  accessGrantId: 'access-grant-1',
  applicationId: 'application-1',
  externalAccountId: 'external-account-1',
  status: 'assigned',
  suggestedReviewerUserIds: ['owner-1', 'manager-1'],
  createdAt: '2026-01-02T03:04:05.000Z',
} satisfies ReviewItem;

const baseDecision = {
  tenantId: 'tenant-1',
  campaignId: 'campaign-1',
  reviewItemId: 'review-item-1',
  reviewerUserId: 'owner-1',
  decidedAt: '2026-01-03T03:04:05.000Z',
  note: 'Reviewed during quarterly campaign.',
};

const expectedStatusByAction = {
  approve: 'approved',
  revoke: 'revoked',
  exception: 'exception',
  needs_follow_up: 'needs_follow_up',
} satisfies Record<ReviewDecisionAction, ReviewItemStatus>;

describe('review lifecycle domain', () => {
  it('T10-C1 links campaigns only to frozen snapshots', () => {
    expect(assertReviewCampaignSnapshotFrozen('frozen')).toBe('frozen');

    expect(() => ReviewCampaignSchema.parse(frozenCampaign)).not.toThrow();
    expect(() => ReviewCampaignSchema.parse({ ...frozenCampaign, snapshotLifecycle: 'building' })).toThrow();
    expect(() => assertReviewCampaignSnapshotFrozen('ready')).toThrow(
      'Review campaigns require a frozen snapshot, received ready',
    );
  });

  it('T10-C2 permits only forward campaign and item transitions', () => {
    expect(isAllowedReviewCampaignTransition('draft', 'active')).toBe(true);
    expect(isAllowedReviewCampaignTransition('active', 'completed')).toBe(true);
    expect(isAllowedReviewCampaignTransition('active', 'cancelled')).toBe(true);
    expect(isAllowedReviewCampaignTransition('completed', 'active')).toBe(false);

    expect(isAllowedReviewItemTransition('pending', 'assigned')).toBe(true);
    expect(isAllowedReviewItemTransition('assigned', 'approved')).toBe(true);
    expect(isAllowedReviewItemTransition('assigned', 'needs_follow_up')).toBe(true);
    expect(isAllowedReviewItemTransition('needs_follow_up', 'assigned')).toBe(true);
    expect(isAllowedReviewItemTransition('approved', 'assigned')).toBe(false);

    expect(() => assertReviewCampaignTransition('completed', 'active')).toThrow(
      'Invalid review campaign transition: completed → active',
    );
    expect(() => assertReviewItemTransition('approved', 'assigned')).toThrow(
      'Invalid review item transition: approved → assigned',
    );
  });

  it('T10-C3 applies each decision action to the review item state machine', () => {
    expect(REVIEW_DECISION_ACTIONS).toEqual(['approve', 'revoke', 'exception', 'needs_follow_up']);
    expect(REVIEW_ITEM_STATUSES).toEqual([
      'pending',
      'assigned',
      'approved',
      'revoked',
      'exception',
      'needs_follow_up',
    ]);

    for (const action of REVIEW_DECISION_ACTIONS) {
      const decision = {
        ...baseDecision,
        decisionId: `decision-${action}`,
        decision: action,
      } satisfies ReviewDecision;

      expect(applyReviewDecision(assignedItem, decision)).toMatchObject({
        decisionId: decision.decisionId,
        status: expectedStatusByAction[action],
      });
    }
  });

  it('T10-C4 suggests reviewers from owner and manager metadata without duplicates', () => {
    expect(
      suggestReviewers({
        accessGrantOwnerUserId: 'owner-1',
        applicationOwnerUserId: 'owner-1',
        externalAccountManagerUserId: 'manager-1',
      }),
    ).toEqual(['owner-1', 'manager-1']);
  });
});
