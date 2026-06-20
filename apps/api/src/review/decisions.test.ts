import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assignReviewItem } from './assignments.js';
import { createReviewCampaign } from './campaign.js';
import { InMemoryReviewDecisionStore, recordReviewDecision } from './decisions.js';
import { generateReviewItems } from './items.js';
import { reviewAssignments, reviewCampaigns, reviewDecisions, reviewItems } from '../db/schema/index.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';
const frozenSnapshotId = '33333333-3333-4333-8333-333333333333';
const resyncSnapshotId = '44444444-4444-4444-8444-444444444444';
const reviewItemId = '55555555-5555-4555-8555-555555555555';
const assignmentId = '66666666-6666-4666-8666-666666666666';
const decisionId = '77777777-7777-4777-8777-777777777777';

function expectFirst<T>(items: readonly T[], message: string): T {
  const first = items[0];

  if (first === undefined) {
    throw new Error(message);
  }

  return first;
}

describe('review decisions', () => {
  it('T10-A1 exports tenant-scoped review persistence tables', () => {
    expect(getTableColumns(reviewCampaigns)).toHaveProperty('tenantId');
    expect(getTableColumns(reviewCampaigns)).toHaveProperty('snapshotId');
    expect(getTableColumns(reviewItems)).toHaveProperty('tenantId');
    expect(getTableColumns(reviewItems)).toHaveProperty('snapshotId');
    expect(getTableColumns(reviewAssignments)).toHaveProperty('tenantId');
    expect(getTableColumns(reviewDecisions)).toHaveProperty('tenantId');
    expect(getTableColumns(reviewDecisions)).toHaveProperty('decision');
  });

  it('T10-A2 records decisions and preserves the campaign-linked frozen snapshot', () => {
    const campaign = createReviewCampaign({
      tenantId,
      campaignId,
      name: 'Q1 Access Review',
      snapshotId: frozenSnapshotId,
      snapshotLifecycle: 'frozen',
      startsAt: '2026-01-02T03:04:05.000Z',
      dueAt: '2026-01-31T03:04:05.000Z',
      createdAt: '2026-01-01T03:04:05.000Z',
    });
    const generatedItem = expectFirst(
      generateReviewItems({
        campaign,
        snapshotId: frozenSnapshotId,
        accessGrants: [
          {
            accessGrantId: 'access-grant-1',
            applicationId: 'application-1',
            externalAccountId: 'external-account-1',
            accessGrantOwnerUserId: 'owner-1',
            externalAccountManagerUserId: 'manager-1',
          },
        ],
        createdAt: '2026-01-02T03:04:05.000Z',
        createReviewItemId: () => reviewItemId,
      }),
      'Expected generated review item',
    );
    const assignment = assignReviewItem({
      item: generatedItem,
      assignmentId,
      reviewerUserId: 'owner-1',
      assignedAt: '2026-01-02T04:04:05.000Z',
    });
    const decisionStore = new InMemoryReviewDecisionStore();

    const decision = recordReviewDecision({
      item: assignment.item,
      decisionId,
      reviewerUserId: assignment.assignment.reviewerUserId,
      decision: 'revoke',
      decidedAt: '2026-01-03T03:04:05.000Z',
      note: 'Remove stale admin grant.',
      store: decisionStore,
    });

    expect(decisionStore.get(decisionId)).toEqual(decision);
    expect(decision.item.snapshotId).toBe(frozenSnapshotId);
    expect(campaign.snapshotId).toBe(frozenSnapshotId);
    expect(resyncSnapshotId).not.toBe(campaign.snapshotId);
    expect(() =>
      generateReviewItems({
        campaign,
        snapshotId: resyncSnapshotId,
        accessGrants: [],
        createdAt: '2026-01-04T03:04:05.000Z',
        createReviewItemId: () => 'unused-review-item-id',
      }),
    ).toThrow('Review items must be generated from campaign snapshot 33333333-3333-4333-8333-333333333333');
  });

  it('T10-A3 rejects campaign creation for non-frozen snapshots', () => {
    expect(() =>
      createReviewCampaign({
        tenantId,
        campaignId,
        name: 'Q1 Access Review',
        snapshotId: frozenSnapshotId,
        snapshotLifecycle: 'ready',
        startsAt: '2026-01-02T03:04:05.000Z',
        dueAt: '2026-01-31T03:04:05.000Z',
        createdAt: '2026-01-01T03:04:05.000Z',
      }),
    ).toThrow('Review campaigns require a frozen snapshot, received ready');
  });
});
