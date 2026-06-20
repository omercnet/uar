import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { InMemoryFinalizationArtifactStore, finalizeReviewExport, type FinalizeReviewExportInput } from '../finalize.js';
import { createCsvFileEvidenceSink } from './csv-file-sink.js';
import { DrataEvidenceSinkStub } from './drata-sink.stub.js';
import { selectEvidenceSinkKind, writeEvidenceToSelectedSink } from './sink.js';

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

const expectedCsv = [
  'section,recordJson',
  'node,"{""label"":""Ada Lovelace"",""nodeType"":""user"",""payload"":{""displayName"":""Ada Lovelace"",""email"":""ada@example.test""},""snapshotId"":""snapshot-1"",""stableId"":""user:ada"",""tenantId"":""tenant-1""}"',
  'node,"{""label"":""Payroll Admin"",""nodeType"":""grant"",""payload"":{""accessId"":""role_admin"",""observedAt"":""2026-01-02T03:04:05.000Z""},""snapshotId"":""snapshot-1"",""stableId"":""grant:payroll-admin"",""tenantId"":""tenant-1""}"',
  'edge,"{""edgeType"":""has_grant"",""payload"":{""applicationId"":""app-payroll"",""recordType"":""access_grant""},""snapshotId"":""snapshot-1"",""sourceNodeStableId"":""user:ada"",""targetNodeStableId"":""grant:payroll-admin"",""tenantId"":""tenant-1""}"',
  'decision,"{""campaignId"":""campaign-1"",""decidedAt"":""2026-01-03T02:04:05.000Z"",""decision"":""approve"",""decisionId"":""decision-1"",""note"":""Access still required."",""reviewItemId"":""item-1"",""reviewerUserId"":""reviewer-1"",""tenantId"":""tenant-1""}"',
  'assignment,"{""assignedAt"":""2026-01-02T04:04:05.000Z"",""assignmentId"":""assignment-1"",""campaignId"":""campaign-1"",""reviewItemId"":""item-1"",""reviewerUserId"":""reviewer-1"",""status"":""completed"",""tenantId"":""tenant-1""}"',
].join('\n') + '\n';

describe('EvidenceSink CSV default sink', () => {
  it('T12-C1 writes deterministic CSV evidence through the tenant-config-selected default sink', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'uar-csv-sink-'));
    const finalizedExport = finalizeReviewExport(baseInput, new InMemoryFinalizationArtifactStore());
    const expectedCsvHash = createHash('sha256').update(expectedCsv).digest('hex');

    const result = await writeEvidenceToSelectedSink({
      selection: {
        tenantId: 'tenant-1',
        campaignId: 'campaign-1',
        tenantConfig: { defaultSinkKind: 'csv-file' },
      },
      registry: {
        csvFile: createCsvFileEvidenceSink({ outputDirectory }),
        drata: new DrataEvidenceSinkStub({ controlId: 'control-1' }),
      },
      writeInput: {
        tenantId: 'tenant-1',
        campaignId: 'campaign-1',
        finalizedExport,
      },
    });

    expect(await readFile(fileURLToPath(result.storageUri), 'utf8')).toBe(expectedCsv);
    expect(result.selection).toEqual({ sinkKind: 'csv-file', selectedBy: 'tenant-config' });
    expect(result.artifact).toMatchObject({
      tenantId: 'tenant-1',
      evidenceArtifactId: `csv-file:sha256:${expectedCsvHash}`,
      contentHash: expectedCsvHash,
      contentType: 'text/csv',
      byteSize: Buffer.byteLength(expectedCsv, 'utf8'),
      immutable: true,
      createdAt: '2026-01-03T03:04:05.000Z',
    });
  });

  it('T12-C2 lets a campaign override choose CSV without invoking the Drata-shaped sink', () => {
    const selection = selectEvidenceSinkKind({
      tenantId: 'tenant-1',
      campaignId: 'campaign-1',
      tenantConfig: { defaultSinkKind: 'drata' },
      campaignOverride: { sinkKind: 'csv-file' },
    });

    expect(selection).toEqual({ sinkKind: 'csv-file', selectedBy: 'campaign-override' });
  });
});
