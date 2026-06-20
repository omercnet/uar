import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InMemoryFinalizationArtifactStore,
  finalizeReviewExport,
  type FinalizeReviewExportInput,
} from './finalize.js';
import { canonicalReviewContent, computeReviewContentHash } from './content-hash.js';

const baseInput = {
  tenantId: 'tenant-1',
  campaignId: 'campaign-1',
  snapshotId: 'snapshot-1',
  finalizedAt: '2026-01-03T03:04:05.000Z',
  nodes: [
    {
      tenantId: 'tenant-1',
      snapshotId: 'snapshot-1',
      nodeType: 'grant',
      stableId: 'grant:payroll-admin',
      label: 'Payroll Admin',
      payload: {
        observedAt: '2026-01-02T03:04:05.000Z',
        accessId: 'role_admin',
      },
    },
    {
      tenantId: 'tenant-1',
      snapshotId: 'snapshot-1',
      nodeType: 'user',
      stableId: 'user:ada',
      label: 'Ada Lovelace',
      payload: {
        email: 'ada@example.test',
        displayName: 'Ada Lovelace',
      },
    },
  ],
  edges: [
    {
      tenantId: 'tenant-1',
      snapshotId: 'snapshot-1',
      sourceNodeStableId: 'user:ada',
      targetNodeStableId: 'grant:payroll-admin',
      edgeType: 'has_grant',
      payload: {
        recordType: 'access_grant',
        applicationId: 'app-payroll',
      },
    },
  ],
  decisions: [
    {
      tenantId: 'tenant-1',
      decisionId: 'decision-1',
      campaignId: 'campaign-1',
      reviewItemId: 'item-1',
      reviewerUserId: 'reviewer-1',
      decision: 'approve',
      decidedAt: '2026-01-03T02:04:05.000Z',
      note: 'Access still required.',
    },
  ],
  assignments: [
    {
      tenantId: 'tenant-1',
      assignmentId: 'assignment-1',
      campaignId: 'campaign-1',
      reviewItemId: 'item-1',
      reviewerUserId: 'reviewer-1',
      status: 'completed',
      assignedAt: '2026-01-02T04:04:05.000Z',
    },
  ],
} satisfies FinalizeReviewExportInput;

const reorderedInput = {
  ...baseInput,
  finalizedAt: '2026-01-04T03:04:05.000Z',
  nodes: [...baseInput.nodes].reverse(),
  decisions: [...baseInput.decisions].reverse(),
  assignments: [...baseInput.assignments].reverse(),
} satisfies FinalizeReviewExportInput;

const expectedCanonicalContent = [
  '[{"label":"Ada Lovelace","nodeType":"user","payload":{"displayName":"Ada Lovelace","email":"ada@example.test"},"snapshotId":"snapshot-1","stableId":"user:ada","tenantId":"tenant-1"},{"label":"Payroll Admin","nodeType":"grant","payload":{"accessId":"role_admin","observedAt":"2026-01-02T03:04:05.000Z"},"snapshotId":"snapshot-1","stableId":"grant:payroll-admin","tenantId":"tenant-1"}]',
  '[{"edgeType":"has_grant","payload":{"applicationId":"app-payroll","recordType":"access_grant"},"snapshotId":"snapshot-1","sourceNodeStableId":"user:ada","targetNodeStableId":"grant:payroll-admin","tenantId":"tenant-1"}]',
  '[{"campaignId":"campaign-1","decidedAt":"2026-01-03T02:04:05.000Z","decision":"approve","decisionId":"decision-1","note":"Access still required.","reviewItemId":"item-1","reviewerUserId":"reviewer-1","tenantId":"tenant-1"}]',
  '[{"assignedAt":"2026-01-02T04:04:05.000Z","assignmentId":"assignment-1","campaignId":"campaign-1","reviewItemId":"item-1","reviewerUserId":"reviewer-1","status":"completed","tenantId":"tenant-1"}]',
].join('\n');

describe('finalize content-hash artifact', () => {
  it('T11-C1 computes a deterministic SHA-256 over canonical review content', () => {
    const expectedHash = createHash('sha256').update(expectedCanonicalContent).digest('hex');

    expect(canonicalReviewContent(baseInput)).toBe(expectedCanonicalContent);
    expect(computeReviewContentHash(baseInput)).toBe(expectedHash);
    expect(computeReviewContentHash(reorderedInput)).toBe(expectedHash);
    expect(expectedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T11-C2 re-finalizes with the same artifact and no duplicate storage side effects', () => {
    const store = new InMemoryFinalizationArtifactStore();

    const first = finalizeReviewExport(baseInput, store);
    const second = finalizeReviewExport(reorderedInput, store);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.artifact).toEqual(second.artifact);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(store.artifacts()).toHaveLength(1);
    expect(store.saveCount).toBe(1);
  });
});
