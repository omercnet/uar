import { describe, expect, it } from 'vitest';
import { ConnectorRecordSchema, type ConnectorRecord } from '../connector/contract.js';
import { SnapshotManifestSchema } from './manifest.js';

const goldenAccessRows = [
  {
    tenantId: 'tenant_acme',
    applicationId: 'app_payroll',
    externalAccountId: 'acct_ada',
    recordType: 'access_grant',
    payload: {
      grantId: 'grant_payroll_admin',
      principalId: 'acct_ada',
      accessType: 'role',
      accessId: 'role_admin',
      source: 'golden-csv',
    },
    observedAt: '2026-06-08T12:00:00.000Z',
  },
] satisfies readonly ConnectorRecord[];

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectKeys(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
  }

  return [];
};

describe('snapshot manifest', () => {
  it('T2-S1 validates a manifest built from golden connector records', () => {
    const parsedRows = goldenAccessRows.map((row) => ConnectorRecordSchema.parse(row));
    const manifest = {
      snapshotId: 'snapshot_2026_06_08',
      tenantId: 'tenant_acme',
      createdAt: '2026-06-08T12:05:00.000Z',
      connectorId: 'payroll-csv',
      recordCounts: parsedRows.reduce<Record<string, number>>((counts, row) => {
        counts[row.recordType] = (counts[row.recordType] ?? 0) + 1;
        return counts;
      }, {}),
      schemaVersion: '1.0.0',
    };

    expect(() => SnapshotManifestSchema.parse(manifest)).not.toThrow();
  });

  it('T2-S3 keeps manifest fields connector agnostic', () => {
    const manifest = SnapshotManifestSchema.parse({
      snapshotId: 'snapshot_2026_06_08',
      tenantId: 'tenant_acme',
      createdAt: '2026-06-08T12:05:00.000Z',
      connectorId: 'payroll-csv',
      recordCounts: { access_grant: 1 },
      schemaVersion: '1.0.0',
    });

    expect(collectKeys(manifest).filter((key) => /github|gws|google|descope/i.test(key))).toEqual([]);
  });
});
