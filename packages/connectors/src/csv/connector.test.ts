import {
  CapabilityDescriptorSchema,
  ConnectorRecordSchema,
  SyncResultSchema,
  type SyncResult,
} from '@uar/core';
import { describe, expect, it } from 'vitest';

import {
  CsvConnectorInputError,
  MANUAL_CSV_CONNECTOR_ID,
  MANUAL_CSV_DESCRIPTOR,
  createCsvConnector,
} from './connector.js';

const observedAt = '2026-06-08T12:00:00.000Z';

const accessCsv = [
  'externalAccountId,email,displayName,grantId,accessId,accessLabel,observedAt',
  'acct_ada,ada@example.test,Ada Lovelace,grant_payroll_admin,role_admin,Payroll Admin,2026-06-08T12:00:00.000Z',
  'acct_grace,grace@example.test,Grace Hopper,grant_payroll_auditor,role_auditor,Payroll Auditor,2026-06-08T12:01:00.000Z',
].join('\n');

async function collectSyncResults(results: AsyncIterable<SyncResult>): Promise<readonly SyncResult[]> {
  const pages: SyncResult[] = [];

  for await (const page of results) {
    pages.push(SyncResultSchema.parse(page));
  }

  return pages;
}

describe('manual CSV connector', () => {
  it('T9-C1 exposes a valid CSV access-grant capability descriptor', () => {
    expect(CapabilityDescriptorSchema.parse(MANUAL_CSV_DESCRIPTOR)).toEqual({
      contractVersion: '1.0.0',
      connectorId: MANUAL_CSV_CONNECTOR_ID,
      capabilities: {
        users: true,
        groups: false,
        roles: true,
        permissions: false,
        access_grants: true,
        owners: false,
        revoke: false,
        evidence_links: false,
      },
    });
  });

  it('T9-C2 streams schema-valid ConnectorRecords with page cursors', async () => {
    const connector = createCsvConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_payroll',
      csvContent: accessCsv,
      observedAt,
      pageSize: 1,
    });

    const pages = await collectSyncResults(connector.sync({ cursor: null }));

    expect(pages.map((page) => page.cursor)).toEqual(['1', null]);
    expect(pages.flatMap((page) => page.records).map((record) => ConnectorRecordSchema.parse(record)))
      .toEqual([
        {
          tenantId: 'tenant_acme',
          applicationId: 'app_payroll',
          externalAccountId: 'acct_ada',
          recordType: 'access_grant',
          payload: {
            externalAccountId: 'acct_ada',
            email: 'ada@example.test',
            displayName: 'Ada Lovelace',
            grantId: 'grant_payroll_admin',
            accessType: 'role',
            accessId: 'role_admin',
            accessLabel: 'Payroll Admin',
            source: 'manual-csv',
          },
          observedAt: '2026-06-08T12:00:00.000Z',
        },
        {
          tenantId: 'tenant_acme',
          applicationId: 'app_payroll',
          externalAccountId: 'acct_grace',
          recordType: 'access_grant',
          payload: {
            externalAccountId: 'acct_grace',
            email: 'grace@example.test',
            displayName: 'Grace Hopper',
            grantId: 'grant_payroll_auditor',
            accessType: 'role',
            accessId: 'role_auditor',
            accessLabel: 'Payroll Auditor',
            source: 'manual-csv',
          },
          observedAt: '2026-06-08T12:01:00.000Z',
        },
      ]);
  });

  it('T9-C3 resumes from the committed cursor without replaying consumed pages', async () => {
    const connector = createCsvConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_payroll',
      csvContent: accessCsv,
      observedAt,
      pageSize: 1,
    });

    const pages = await collectSyncResults(connector.sync({ cursor: '1' }));

    expect(pages).toHaveLength(1);
    expect(pages[0]?.cursor).toBeNull();
    expect(pages[0]?.records[0]?.externalAccountId).toBe('acct_grace');
  });

  it('T9-C4 rejects CSV input missing required access columns', async () => {
    const connector = createCsvConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_payroll',
      csvContent: ['email,displayName', 'ada@example.test,Ada Lovelace'].join('\n'),
      observedAt,
    });

    await expect(collectSyncResults(connector.sync({ cursor: null }))).rejects.toThrow(
      CsvConnectorInputError,
    );
  });
});
