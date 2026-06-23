import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabaseClient, getDatabaseUrl } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';
import { reviewCampaigns, snapshots, tenants } from '../db/schema/index.js';
import { type TenantDb, withTenantTransaction } from '../db/tenant-context.js';
import { canConnect, resetUarDatabase } from '../db/test-support.js';
import {
  createCampaignWithSnapshot,
  getCampaign,
  listCampaigns,
  updateCampaignStatus,
} from './campaign-repo.js';

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

type CampaignFixture = {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly startsAt: Date;
  readonly dueAt: Date;
};

async function prepareMigratedDatabase(): Promise<ReturnType<typeof createDatabaseClient>> {
  await resetUarDatabase(databaseUrl);
  await migrateDatabase({ databaseUrl });

  return createDatabaseClient(databaseUrl, { max: 1 });
}

async function seedTenant(tx: TenantDb, tenantId: string, slug: string): Promise<void> {
  await tx.insert(tenants).values({ tenantId, slug, name: slug });
}

function createFixture(): CampaignFixture {
  return {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    startsAt: new Date('2026-01-02T03:04:05.000Z'),
    dueAt: new Date('2026-01-31T03:04:05.000Z'),
  };
}

describe('review campaign repository', () => {
  it.skipIf(!databaseReachable)('creates a campaign with a FK-valid placeholder snapshot', async () => {
    // Given
    const fixture = createFixture();
    const { client, db } = await prepareMigratedDatabase();

    try {
      await withTenantTransaction(db, fixture.tenantA, (tx) => seedTenant(tx, fixture.tenantA, 'tenant-a'));

      // When
      const created = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        createCampaignWithSnapshot(tx, fixture.tenantA, {
          name: 'Q1 Access Review',
          snapshotId: 'directory-snapshot-label',
          startsAt: fixture.startsAt,
          dueAt: fixture.dueAt,
        }),
      );
      const [snapshotRow] = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        tx.select().from(snapshots).where(eq(snapshots.id, created.snapshotId)).limit(1),
      );
      const [campaignRow] = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        tx.select().from(reviewCampaigns).where(eq(reviewCampaigns.id, created.campaignId)).limit(1),
      );

      // Then
      expect(snapshotRow).toMatchObject({
        id: created.snapshotId,
        tenantId: fixture.tenantA,
        lifecycle: 'building',
      });
      expect(snapshotRow?.manifest).toMatchObject({ snapshotId: 'directory-snapshot-label' });
      expect(campaignRow).toMatchObject({ snapshotId: created.snapshotId });
      expect(created).toMatchObject({
        tenantId: fixture.tenantA,
        name: 'Q1 Access Review',
        snapshotLifecycle: 'frozen',
        status: 'draft',
      });
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });

  it.skipIf(!databaseReachable)('gets and lists campaigns for the current tenant only', async () => {
    // Given
    const fixture = createFixture();
    const { client, db } = await prepareMigratedDatabase();

    try {
      await withTenantTransaction(db, fixture.tenantA, (tx) => seedTenant(tx, fixture.tenantA, 'tenant-a'));
      await withTenantTransaction(db, fixture.tenantB, (tx) => seedTenant(tx, fixture.tenantB, 'tenant-b'));
      const created = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        createCampaignWithSnapshot(tx, fixture.tenantA, {
          name: 'Q1 Access Review',
          snapshotId: 'directory-snapshot-label',
          startsAt: fixture.startsAt,
          dueAt: fixture.dueAt,
        }),
      );

      // When
      const found = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        getCampaign(tx, fixture.tenantA, created.campaignId),
      );
      const listed = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        listCampaigns(tx, fixture.tenantA),
      );
      const hidden = await withTenantTransaction(db, fixture.tenantB, (tx) =>
        getCampaign(tx, fixture.tenantB, created.campaignId),
      );

      // Then
      expect(found).toEqual(created);
      expect(listed).toContainEqual(created);
      expect(hidden).toBeUndefined();
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });

  it.skipIf(!databaseReachable)('throws on invalid status transitions', async () => {
    // Given
    const fixture = createFixture();
    const { client, db } = await prepareMigratedDatabase();

    try {
      await withTenantTransaction(db, fixture.tenantA, (tx) => seedTenant(tx, fixture.tenantA, 'tenant-a'));
      const created = await withTenantTransaction(db, fixture.tenantA, (tx) =>
        createCampaignWithSnapshot(tx, fixture.tenantA, {
          name: 'Q1 Access Review',
          snapshotId: 'directory-snapshot-label',
          startsAt: fixture.startsAt,
          dueAt: fixture.dueAt,
        }),
      );
      await withTenantTransaction(db, fixture.tenantA, (tx) =>
        updateCampaignStatus(tx, fixture.tenantA, created.campaignId, 'active'),
      );
      await withTenantTransaction(db, fixture.tenantA, (tx) =>
        updateCampaignStatus(tx, fixture.tenantA, created.campaignId, 'completed'),
      );

      // When / Then
      await expect(
        withTenantTransaction(db, fixture.tenantA, (tx) =>
          updateCampaignStatus(tx, fixture.tenantA, created.campaignId, 'active'),
        ),
      ).rejects.toThrow('Invalid review campaign transition: completed → active');
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
