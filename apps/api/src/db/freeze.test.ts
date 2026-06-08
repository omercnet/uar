import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { finalizeSnapshotManifest } from '@uar/core';
import { getTableColumns } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { beginSnapshotBuild } from '../snapshot/lifecycle.js';
import { getDatabaseUrl } from './client.js';
import { migrateDatabase } from './migrate.js';
import * as schema from './schema/index.js';

type SqlClient = ReturnType<typeof postgres>;

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

async function canConnect(url: string): Promise<boolean> {
  const sql = postgres(url, {
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

async function resetSnapshotDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await sql`drop table if exists snapshot_edges cascade`;
    await sql`drop table if exists snapshot_nodes cascade`;
    await sql`drop table if exists snapshots cascade`;
    await sql`drop table if exists ingestion_observations cascade`;
    await sql`drop table if exists access_grants cascade`;
    await sql`drop table if exists external_accounts cascade`;
    await sql`drop table if exists ingestion_runs cascade`;
    await sql`drop table if exists applications cascade`;
    await sql`drop table if exists user_identities cascade`;
    await sql`drop table if exists tenants cascade`;
    await sql`drop function if exists enforce_snapshot_lifecycle_transition() cascade`;
    await sql`drop function if exists reject_frozen_snapshot_record_mutation() cascade`;
    await sql`drop type if exists snapshot_lifecycle cascade`;
    await sql`drop schema if exists drizzle cascade`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function expectMutationRejected(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toThrow(/frozen snapshot/i);
}

function expectRow<T>(rows: T[], message: string): T {
  const row = rows[0];

  if (row === undefined) {
    throw new Error(message);
  }

  return row;
}

async function freezeSnapshot(sql: SqlClient, tenantId: string, snapshotId: string): Promise<void> {
  const finalized = finalizeSnapshotManifest({
    snapshotId,
    tenantId,
    createdAt: '2026-01-02T03:04:05.000Z',
    connectorId: 'manual-csv',
    recordCounts: {
      snapshotEdges: 1,
      snapshotNodes: 2,
    },
    schemaVersion: '1',
  });

  await sql`
    update snapshots
    set lifecycle = 'ready'
    where tenant_id = ${tenantId}
      and id = ${snapshotId}
  `;
  await sql`
    update snapshots
    set lifecycle = 'frozen', manifest = ${sql.json(finalized.manifest)}, manifest_hash = ${finalized.manifestHash}
    where tenant_id = ${tenantId}
      and id = ${snapshotId}
  `;
}

describe('snapshot freeze substrate', () => {
  it('T4-S1 exports tenant-scoped snapshot tables', () => {
    const snapshotColumns = getTableColumns(schema.snapshots);
    const nodeColumns = getTableColumns(schema.snapshotNodes);
    const edgeColumns = getTableColumns(schema.snapshotEdges);

    expect(snapshotColumns).toHaveProperty('tenantId');
    expect(snapshotColumns).toHaveProperty('lifecycle');
    expect(snapshotColumns).toHaveProperty('manifestHash');
    expect(nodeColumns).toHaveProperty('tenantId');
    expect(nodeColumns).toHaveProperty('snapshotId');
    expect(edgeColumns).toHaveProperty('tenantId');
    expect(edgeColumns).toHaveProperty('snapshotId');
  });

  it('T4-S2 ships a DB freeze trigger migration', async () => {
    const migrationSql = await readFile(
      resolve(process.cwd(), 'drizzle', '0001_snapshot_lifecycle_freeze_trigger.sql'),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE TYPE "snapshot_lifecycle" AS ENUM');
    expect(migrationSql).toContain('enforce_snapshot_lifecycle_transition');
    expect(migrationSql).toContain('reject_frozen_snapshot_record_mutation');
    expect(migrationSql).toContain('snapshot_nodes_freeze_guard');
    expect(migrationSql).toContain('snapshot_edges_freeze_guard');
  });

  it.skipIf(!databaseReachable)(
    'T4-S3 freeze trigger rejects INSERT/UPDATE/DELETE against frozen snapshot records',
    async () => {
      await resetSnapshotDatabase(databaseUrl);
      await migrateDatabase({ databaseUrl });

      const sql = postgres(databaseUrl, { max: 1 });
      const tenantId = '11111111-1111-4111-8111-111111111111';
      const snapshotId = '22222222-2222-4222-8222-222222222222';
      const sourceNodeId = '33333333-3333-4333-8333-333333333333';
      const targetNodeId = '44444444-4444-4444-8444-444444444444';
      const edgeId = '55555555-5555-4555-8555-555555555555';

      try {
        await sql`
          insert into tenants (tenant_id, slug, name)
          values (${tenantId}, 'freeze-trigger', 'Freeze Trigger')
        `;
        await sql`
          insert into snapshots (id, tenant_id, connector_id, lifecycle, manifest)
          values (
            ${snapshotId},
            ${tenantId},
            'manual-csv',
            'building',
            ${sql.json({
              snapshotId,
              tenantId,
              createdAt: '2026-01-02T03:04:05.000Z',
              connectorId: 'manual-csv',
              recordCounts: {},
              schemaVersion: '1',
            })}
          )
        `;
        await sql`
          insert into snapshot_nodes (id, tenant_id, snapshot_id, node_type, stable_id, label, payload)
          values
            (${sourceNodeId}, ${tenantId}, ${snapshotId}, 'user', 'user-1', 'User 1', ${sql.json({ email: 'u1@example.test' })}),
            (${targetNodeId}, ${tenantId}, ${snapshotId}, 'grant', 'grant-1', 'Grant 1', ${sql.json({ role: 'admin' })})
        `;
        await sql`
          insert into snapshot_edges (id, tenant_id, snapshot_id, source_node_id, target_node_id, edge_type, payload)
          values (${edgeId}, ${tenantId}, ${snapshotId}, ${sourceNodeId}, ${targetNodeId}, 'has_grant', ${sql.json({ source: 'csv' })})
        `;
        await freezeSnapshot(sql, tenantId, snapshotId);

        await expectMutationRejected(() => sql`
          insert into snapshot_nodes (tenant_id, snapshot_id, node_type, stable_id, label, payload)
          values (${tenantId}, ${snapshotId}, 'grant', 'grant-2', 'Grant 2', ${sql.json({ role: 'viewer' })})
        `);
        await expectMutationRejected(() => sql`
          update snapshot_nodes
          set label = 'Tampered User'
          where tenant_id = ${tenantId}
            and id = ${sourceNodeId}
        `);
        await expectMutationRejected(() => sql`
          delete from snapshot_edges
          where tenant_id = ${tenantId}
            and id = ${edgeId}
        `);
      } finally {
        await sql.end({ timeout: 1 });
        await resetSnapshotDatabase(databaseUrl);
      }
    },
  );

  it.skipIf(!databaseReachable)(
    'T4-S4 re-sync creates a distinct snapshot row and leaves frozen row byte-identical',
    async () => {
      await resetSnapshotDatabase(databaseUrl);
      await migrateDatabase({ databaseUrl });

      const sql = postgres(databaseUrl, { max: 1 });
      const tenantId = '66666666-6666-4666-8666-666666666666';
      const frozenSnapshotId = '77777777-7777-4777-8777-777777777777';
      const resyncSnapshotId = '88888888-8888-4888-8888-888888888888';

      try {
        await sql`
          insert into tenants (tenant_id, slug, name)
          values (${tenantId}, 'resync-freeze', 'Resync Freeze')
        `;

        const frozenBuild = beginSnapshotBuild(
          {
            tenantId,
            connectorId: 'manual-csv',
            createdAt: '2026-01-02T03:04:05.000Z',
            schemaVersion: '1',
          },
          { createSnapshotId: () => frozenSnapshotId },
        );
        await sql`
          insert into snapshots (id, tenant_id, connector_id, lifecycle, manifest)
          values (
            ${frozenBuild.id},
            ${frozenBuild.tenantId},
            ${frozenBuild.connectorId},
            ${frozenBuild.lifecycle},
            ${sql.json(frozenBuild.manifest)}
          )
        `;
        await freezeSnapshot(sql, tenantId, frozenSnapshotId);

        const beforeRows = await sql<{ frozenRow: Record<string, unknown> }[]>`
          select to_jsonb(s) as "frozenRow"
          from snapshots s
          where tenant_id = ${tenantId}
            and id = ${frozenSnapshotId}
        `;
        const before = expectRow(beforeRows, 'Expected frozen snapshot before re-sync');

        const resyncBuild = beginSnapshotBuild(
          {
            tenantId,
            connectorId: 'manual-csv',
            createdAt: '2026-01-03T03:04:05.000Z',
            schemaVersion: '1',
          },
          { createSnapshotId: () => resyncSnapshotId },
        );
        await sql`
          insert into snapshots (id, tenant_id, connector_id, lifecycle, manifest)
          values (
            ${resyncBuild.id},
            ${resyncBuild.tenantId},
            ${resyncBuild.connectorId},
            ${resyncBuild.lifecycle},
            ${sql.json(resyncBuild.manifest)}
          )
        `;

        const afterRows = await sql<{ frozenRow: Record<string, unknown> }[]>`
          select to_jsonb(s) as "frozenRow"
          from snapshots s
          where tenant_id = ${tenantId}
            and id = ${frozenSnapshotId}
        `;
        const snapshotRows = await sql<{ id: string; lifecycle: string }[]>`
          select id, lifecycle::text as lifecycle
          from snapshots
          where tenant_id = ${tenantId}
          order by id
        `;
        const after = expectRow(afterRows, 'Expected frozen snapshot after re-sync');

        expect(resyncBuild.id).not.toBe(frozenBuild.id);
        expect(after.frozenRow).toEqual(before.frozenRow);
        expect(snapshotRows).toEqual([
          { id: frozenSnapshotId, lifecycle: 'frozen' },
          { id: resyncSnapshotId, lifecycle: 'building' },
        ]);
      } finally {
        await sql.end({ timeout: 1 });
        await resetSnapshotDatabase(databaseUrl);
      }
    },
  );
});
