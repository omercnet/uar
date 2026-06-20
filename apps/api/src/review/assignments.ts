import type { ReviewItemRecord } from './items.js';
import { markReviewItemAssigned } from './items.js';

export interface AssignReviewItemInput {
  readonly item: ReviewItemRecord;
  readonly assignmentId: string;
  readonly reviewerUserId: string;
  readonly assignedAt: string;
  readonly dueAt?: string;
}

export interface ReviewAssignmentRecord {
  readonly tenantId: string;
  readonly assignmentId: string;
  readonly campaignId: string;
  readonly reviewItemId: string;
  readonly reviewerUserId: string;
  readonly status: 'assigned';
  readonly assignedAt: string;
  readonly dueAt?: string;
}

export interface AssignReviewItemResult {
  readonly item: ReviewItemRecord;
  readonly assignment: ReviewAssignmentRecord;
}

export function assignReviewItem(input: AssignReviewItemInput): AssignReviewItemResult {
  const item = markReviewItemAssigned(input.item);

  return {
    item,
    assignment: {
      tenantId: item.tenantId,
      assignmentId: input.assignmentId,
      campaignId: item.campaignId,
      reviewItemId: item.reviewItemId,
      reviewerUserId: input.reviewerUserId,
      status: 'assigned',
      assignedAt: input.assignedAt,
      dueAt: input.dueAt,
    },
  };
}
