import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabaseClient, getDatabaseUrl } from './client.js';
import { migrateDatabase } from './migrate.js';
import { tenants } from './schema/index.js';
import { BlankTenantIdError, type TenantDb, withTenantTransaction } from './tenant-context.js';
import { canConnect, resetUarDatabase } from './test-support.js';

type TenantRow = {
  readonly tenantId: string;
};

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

async function prepareMigratedDatabase(): Promise<ReturnType<typeof createDatabaseClient>> {
  await resetUarDatabase(databaseUrl);
  await migrateDatabase({ databaseUrl });

  return createDatabaseClient(databaseUrl, { max: 1 });
}

async function seedTenant(tx: TenantDb, tenantId: string, slug: string): Promise<void> {
  await tx.insert(tenants).values({ tenantId, slug, name: slug });
}

async function matchingTenantRows(tx: TenantDb, tenantId: string): Promise<TenantRow[]> {
  return tx.select({ tenantId: tenants.tenantId }).from(tenants).where(eq(tenants.tenantId, tenantId));
}

describe('tenant transaction context', () => {
  it('rejects blank tenant ids before starting a database transaction', async () => {
    // Given
    const { client, db } = createDatabaseClient('postgres://uar:uar_dev_password@127.0.0.1:1/uar', {
      connect_timeout: 1,
      idle_timeout: 1,
      max: 1,
    });
    const blankTenantId = ' \t ';

    try {
      // When / Then
      await expect(withTenantTransaction(db, blankTenantId, async () => undefined)).rejects.toMatchObject({
        name: 'BlankTenantIdError',
        tenantId: blankTenantId,
      } satisfies Pick<BlankTenantIdError, 'name' | 'tenantId'>);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it.skipIf(!databaseReachable)('hides tenant rows from other tenant transactions', async () => {
    // Given
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const { client, db } = await prepareMigratedDatabase();

    try {
      await withTenantTransaction(db, tenantA, (tx) => seedTenant(tx, tenantA, 'tenant-a'));

      // When
      const rowsVisibleToTenantB = await withTenantTransaction(db, tenantB, (tx) =>
        matchingTenantRows(tx, tenantA),
      );

      // Then
      expect(rowsVisibleToTenantB).toEqual([]);
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });

  it.skipIf(!databaseReachable)('keeps tenant GUC scoped to the current transaction', async () => {
    // Given
    const tenantA = randomUUID();
    const { client, db } = await prepareMigratedDatabase();

    try {
      await withTenantTransaction(db, tenantA, (tx) => seedTenant(tx, tenantA, 'tx-local-tenant'));

      // When
      const rowsWithoutTenantContext = await db.transaction((tx) => matchingTenantRows(tx, tenantA));

      // Then
      expect(rowsWithoutTenantContext).toEqual([]);
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
