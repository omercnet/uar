import type { ConnectorRecord } from '@uar/core';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabaseClient, getDatabaseUrl } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';
import { accessGrants, applications, externalAccounts, tenants, userIdentities } from '../db/schema/index.js';
import { canConnect, resetUarDatabase } from '../db/test-support.js';
import { withTenantTransaction, type TenantDb } from '../db/tenant-context.js';
import { upsertDirectoryGraph } from './directory-repo.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

const accessGrantRecords = [
  createAccessGrantRecord('acct-1', 'alice@example.test', 'Alice Example', 'role-admin', 'Admin'),
  createAccessGrantRecord('acct-2', 'bob@example.test', 'Bob Example', 'role-editor', 'Editor'),
  createAccessGrantRecord('acct-3', 'carol@example.test', 'Carol Example', 'role-viewer', 'Viewer'),
  createAccessGrantRecord('acct-4', 'dave@example.test', 'Dave Example', 'role-auditor', 'Auditor'),
] satisfies readonly ConnectorRecord[];

type TenantTable = typeof applications | typeof userIdentities | typeof externalAccounts | typeof accessGrants;

function createAccessGrantRecord(
  externalAccountId: string,
  email: string,
  displayName: string,
  accessId: string,
  accessLabel: string,
): ConnectorRecord {
  return {
    tenantId,
    applicationId: 'directory',
    externalAccountId,
    recordType: 'access_grant',
    payload: {
      externalAccountId,
      email,
      displayName,
      grantId: accessId,
      accessType: 'role',
      accessId,
      accessLabel,
      source: 'manual-csv',
    },
    observedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function countTenantRows(tx: TenantDb, table: TenantTable): Promise<number> {
  const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(table).where(eq(table.tenantId, tenantId));

  if (row === undefined) {
    throw new Error('Count query returned no row');
  }

  return row.count;
}

async function countDirectoryRows(tx: TenantDb): Promise<readonly [number, number, number, number]> {
  return Promise.all([
    countTenantRows(tx, applications),
    countTenantRows(tx, userIdentities),
    countTenantRows(tx, externalAccounts),
    countTenantRows(tx, accessGrants),
  ]);
}

describe('directory graph repository', () => {
  it.skipIf(!databaseReachable)('T3 persists access-grant directory graph rows idempotently', async () => {
    await resetUarDatabase(databaseUrl);
    await migrateDatabase({ databaseUrl });
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1 });

    try {
      await withTenantTransaction(db, tenantId, async (tx) => {
        // Given
        await tx.insert(tenants).values({ tenantId, slug: 'directory-repo', name: 'Directory Repo' });

        // When
        const firstResult = await upsertDirectoryGraph(tx, tenantId, accessGrantRecords);
        const firstCounts = await countDirectoryRows(tx);
        const secondResult = await upsertDirectoryGraph(tx, tenantId, accessGrantRecords);
        const secondCounts = await countDirectoryRows(tx);

        // Then
        expect(firstCounts).toEqual([1, 4, 4, 4]);
        expect(secondCounts).toEqual([1, 4, 4, 4]);
        expect(secondResult).toEqual(firstResult);
        expect(firstResult.applications.directory).toBeDefined();
        expect(Object.keys(firstResult.userIdentities)).toHaveLength(4);
        expect(Object.keys(firstResult.externalAccounts)).toHaveLength(4);
        expect(Object.keys(firstResult.accessGrants)).toHaveLength(4);
      });
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
