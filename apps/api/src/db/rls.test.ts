import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { getDatabaseUrl } from './client.js';
import { migrateDatabase } from './migrate.js';
import type { SqlClient } from './test-support.js';
import { canConnect, resetUarDatabase, setTenantContext, tenantScopedTables } from './test-support.js';

type TenantFixture = {
  readonly tenantId: string;
  readonly slug: string;
  readonly applicationId: string;
  readonly userIdentityId: string;
  readonly ingestionRunId: string;
  readonly externalAccountId: string;
  readonly accessGrantId: string;
  readonly ingestionObservationId: string;
  readonly snapshotId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly snapshotEdgeId: string;
  readonly connectorCredentialId: string;
  readonly reviewCampaignId: string;
  readonly reviewItemId: string;
  readonly reviewAssignmentId: string;
  readonly reviewDecisionId: string;
};

const tenantATestData = createTenantFixture('1', 'rls-tenant-a');
const tenantBTestData = createTenantFixture('2', 'rls-tenant-b');

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

function createTenantFixture(seed: '1' | '2', slug: string): TenantFixture {
  return {
    tenantId: seededUuid(seed, 1),
    slug,
    applicationId: seededUuid(seed, 2),
    userIdentityId: seededUuid(seed, 3),
    ingestionRunId: seededUuid(seed, 4),
    externalAccountId: seededUuid(seed, 5),
    accessGrantId: seededUuid(seed, 6),
    ingestionObservationId: seededUuid(seed, 7),
    snapshotId: seededUuid(seed, 8),
    sourceNodeId: seededUuid(seed, 9),
    targetNodeId: seededUuid(seed, 10),
    snapshotEdgeId: seededUuid(seed, 11),
    connectorCredentialId: seededUuid(seed, 12),
    reviewCampaignId: seededUuid(seed, 13),
    reviewItemId: seededUuid(seed, 14),
    reviewAssignmentId: seededUuid(seed, 15),
    reviewDecisionId: seededUuid(seed, 16),
  };
}

function seededUuid(seed: '1' | '2', sequence: number): string {
  const suffix = sequence.toString(16).padStart(4, '0');

  return `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(8)}${suffix}`;
}

async function insertTenantFixture(sql: SqlClient, fixture: TenantFixture): Promise<void> {
  await setTenantContext(sql, fixture.tenantId);
  await sql`insert into tenants (tenant_id, slug, name) values (${fixture.tenantId}, ${fixture.slug}, ${fixture.slug})`;
  await sql`
    insert into applications (id, tenant_id, key, name, connector_id)
    values (${fixture.applicationId}, ${fixture.tenantId}, 'directory', 'Directory', 'manual-csv')
  `;
  await sql`
    insert into user_identities (id, tenant_id, primary_email, display_name)
    values (${fixture.userIdentityId}, ${fixture.tenantId}, ${`${fixture.slug}@example.test`}, 'Reviewer')
  `;
  await sql`
    insert into ingestion_runs (id, tenant_id, connector_id, status)
    values (${fixture.ingestionRunId}, ${fixture.tenantId}, 'manual-csv', 'completed')
  `;
  await sql`
    insert into external_accounts (id, tenant_id, application_id, user_identity_id, external_id, display_name)
    values (${fixture.externalAccountId}, ${fixture.tenantId}, ${fixture.applicationId}, ${fixture.userIdentityId}, 'external-1', 'External Account')
  `;
  await sql`
    insert into access_grants (id, tenant_id, application_id, external_account_id, user_identity_id, grant_type, grant_value, source)
    values (${fixture.accessGrantId}, ${fixture.tenantId}, ${fixture.applicationId}, ${fixture.externalAccountId}, ${fixture.userIdentityId}, 'role', 'admin', 'fixture')
  `;
  await sql`
    insert into ingestion_observations (id, tenant_id, ingestion_run_id, record_type, payload)
    values (${fixture.ingestionObservationId}, ${fixture.tenantId}, ${fixture.ingestionRunId}, 'account', ${sql.json({ externalId: 'external-1' })})
  `;
  await sql`
    insert into snapshots (id, tenant_id, connector_id, ingestion_run_id, manifest)
    values (${fixture.snapshotId}, ${fixture.tenantId}, 'manual-csv', ${fixture.ingestionRunId}, ${sql.json({ schemaVersion: '1' })})
  `;
  await sql`
    insert into snapshot_nodes (id, tenant_id, snapshot_id, node_type, stable_id, label, payload)
    values
      (${fixture.sourceNodeId}, ${fixture.tenantId}, ${fixture.snapshotId}, 'user', 'user-1', 'User', ${sql.json({ email: `${fixture.slug}@example.test` })}),
      (${fixture.targetNodeId}, ${fixture.tenantId}, ${fixture.snapshotId}, 'grant', 'grant-1', 'Grant', ${sql.json({ role: 'admin' })})
  `;
  await sql`
    insert into snapshot_edges (id, tenant_id, snapshot_id, source_node_id, target_node_id, edge_type, payload)
    values (${fixture.snapshotEdgeId}, ${fixture.tenantId}, ${fixture.snapshotId}, ${fixture.sourceNodeId}, ${fixture.targetNodeId}, 'has_grant', ${sql.json({ source: 'fixture' })})
  `;
  await sql`
    insert into connector_credentials (id, tenant_id, application_id, name, encrypted_secret)
    values (${fixture.connectorCredentialId}, ${fixture.tenantId}, ${fixture.applicationId}, 'credential', ${sql.json({ ciphertext: 'sealed' })})
  `;
  await sql`
    insert into review_campaigns (id, tenant_id, snapshot_id, name, starts_at, due_at)
    values (${fixture.reviewCampaignId}, ${fixture.tenantId}, ${fixture.snapshotId}, 'Quarterly review', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
  `;
  await sql`
    insert into review_items (id, tenant_id, campaign_id, snapshot_id, access_grant_id, application_id, external_account_id)
    values (${fixture.reviewItemId}, ${fixture.tenantId}, ${fixture.reviewCampaignId}, ${fixture.snapshotId}, ${fixture.accessGrantId}, ${fixture.applicationId}, ${fixture.externalAccountId})
  `;
  await sql`
    insert into review_assignments (id, tenant_id, campaign_id, review_item_id, reviewer_user_id, assigned_at)
    values (${fixture.reviewAssignmentId}, ${fixture.tenantId}, ${fixture.reviewCampaignId}, ${fixture.reviewItemId}, ${fixture.userIdentityId}, '2026-01-02T00:00:00Z')
  `;
  await sql`
    insert into review_decisions (id, tenant_id, campaign_id, review_item_id, reviewer_user_id, decision, note, decided_at)
    values (${fixture.reviewDecisionId}, ${fixture.tenantId}, ${fixture.reviewCampaignId}, ${fixture.reviewItemId}, ${fixture.userIdentityId}, 'approve', 'Looks good', '2026-01-03T00:00:00Z')
  `;
}

describe('tenant row-level security', () => {
  it.skipIf(!databaseReachable)(
    'T15-R1 creates one tenant isolation policy for every tenant-scoped table',
    async () => {
      // Given
      await resetUarDatabase(databaseUrl);
      await migrateDatabase({ databaseUrl });
      const sql = postgres(databaseUrl, { max: 1 });

      try {
        // When
        const policies = await sql<{ tableName: string; policyName: string }[]>`
          select tablename as "tableName", policyname as "policyName"
          from pg_policies
          where schemaname = 'public'
            and tablename in ${sql(tenantScopedTables)}
          order by tablename
        `;
        const tablesWithRls = await sql<{ tableName: string }[]>`
          select relname as "tableName"
          from pg_class
          where relnamespace = 'public'::regnamespace
            and relname in ${sql(tenantScopedTables)}
            and relrowsecurity
            and relforcerowsecurity
          order by relname
        `;

        // Then
        expect(tablesWithRls.map((table) => table.tableName)).toEqual([...tenantScopedTables].sort());
        expect(policies).toEqual(
          [...tenantScopedTables].sort().map((tableName) => ({
            tableName,
            policyName: `${tableName}_tenant_isolation`,
          })),
        );
      } finally {
        await sql.end({ timeout: 1 });
        await resetUarDatabase(databaseUrl);
      }
    },
  );

  it.skipIf(!databaseReachable)(
    'T15-R2 hides every tenant-scoped row owned by a different tenant',
    async () => {
      // Given
      await resetUarDatabase(databaseUrl);
      await migrateDatabase({ databaseUrl });
      const sql = postgres(databaseUrl, { max: 1 });

      try {
        await insertTenantFixture(sql, tenantATestData);
        await insertTenantFixture(sql, tenantBTestData);
        await setTenantContext(sql, tenantATestData.tenantId);

        // When / Then
        for (const table of tenantScopedTables) {
          const rows = await sql<{ tenantId: string }[]>`
            select tenant_id::text as "tenantId"
            from ${sql(table)}
            order by tenant_id
          `;

          expect(rows, `${table} must not leak cross-tenant rows`).toEqual([
            { tenantId: tenantATestData.tenantId },
          ]);
        }
      } finally {
        await sql.end({ timeout: 1 });
        await resetUarDatabase(databaseUrl);
      }
    },
  );

  it.skipIf(!databaseReachable)(
    'T15-R3 rejects writes stamped with a different tenant',
    async () => {
      // Given
      await resetUarDatabase(databaseUrl);
      await migrateDatabase({ databaseUrl });
      const sql = postgres(databaseUrl, { max: 1 });

      try {
        await insertTenantFixture(sql, tenantATestData);
        await setTenantContext(sql, tenantATestData.tenantId);

        // When / Then
        await expect(sql`
          insert into applications (tenant_id, key, name, connector_id)
          values (${tenantBTestData.tenantId}, 'blocked-app', 'Blocked App', 'manual-csv')
        `).rejects.toThrow(/row-level security/i);

        await expect(sql`
          update applications
          set tenant_id = ${tenantBTestData.tenantId}
          where id = ${tenantATestData.applicationId}
        `).rejects.toThrow(/row-level security/i);
      } finally {
        await sql.end({ timeout: 1 });
        await resetUarDatabase(databaseUrl);
      }
    },
  );
});
