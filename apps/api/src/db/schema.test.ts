import postgres from 'postgres';
import { getTableColumns, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { getDatabaseUrl } from './client.js';
import { migrateDatabase } from './migrate.js';
import * as schema from './schema/index.js';

const expectedTables = [
  'accessGrants',
  'applications',
  'connectorCredentials',
  'externalAccounts',
  'ingestionObservations',
  'ingestionRuns',
  'tenants',
  'userIdentities',
] as const;

const migratedTableNames = [
  'access_grants',
  'applications',
  'connector_credentials',
  'external_accounts',
  'ingestion_observations',
  'ingestion_runs',
  'tenants',
  'user_identities',
] as const;

function exportedPgTables() {
  return Object.entries(schema).filter((entry): entry is [string, PgTable] =>
    is(entry[1], PgTable),
  );
}

async function canConnect(databaseUrl: string): Promise<boolean> {
  const sql = postgres(databaseUrl, {
    connect_timeout: 1,
    idle_timeout: 1,
    max: 1,
  });

  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function dropTask3Tables(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql`drop table if exists ingestion_observations cascade`;
    await sql`drop table if exists access_grants cascade`;
    await sql`drop table if exists connector_credentials cascade`;
    await sql`drop table if exists external_accounts cascade`;
    await sql`drop table if exists ingestion_runs cascade`;
    await sql`drop table if exists applications cascade`;
    await sql`drop table if exists user_identities cascade`;
    await sql`drop table if exists tenants cascade`;
    await sql`drop schema if exists drizzle cascade`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

describe('Drizzle tenant schema', () => {
  it('T3-S1 exports only tenant-scoped pgTables', () => {
    const tables = exportedPgTables();

    expect(tables.map(([name]) => name).sort()).toEqual([...expectedTables].sort());

    for (const [name, table] of tables) {
      const hasTenantId = Object.values(getTableColumns(table)).some(
        (column) => column.name === 'tenant_id',
      );

      expect(hasTenantId, `${name} must include tenant_id`).toBe(true);
    }
  });

  it('T3-S2 keeps ingestion observations append-only', () => {
    const columns = getTableColumns(schema.ingestionObservations);

    expect(columns).toHaveProperty('observedAt');
    expect(columns).not.toHaveProperty('updatedAt');
  });

  it.skipIf(!databaseReachable)(
    'T3-S3 applies migrations and drops Task 3 tables cleanly when Postgres is reachable',
    async () => {
      await dropTask3Tables(databaseUrl);
      await migrateDatabase({ databaseUrl });

      const sql = postgres(databaseUrl, { max: 1 });

      try {
        const tables = await sql<{ tableName: string }[]>`
          select table_name as "tableName"
          from information_schema.tables
          where table_schema = 'public'
            and table_name in ${sql(migratedTableNames)}
          order by table_name
        `;

        expect(tables.map((table) => table.tableName)).toEqual([...migratedTableNames].sort());
      } finally {
        await sql.end({ timeout: 1 });
        await dropTask3Tables(databaseUrl);
      }
    },
  );
});
