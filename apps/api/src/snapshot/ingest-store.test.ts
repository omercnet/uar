import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { TenantContext } from '@uar/core';
import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDatabaseUrl, createDatabaseClient } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';
import { snapshots, snapshotEdges, snapshotNodes, tenants } from '../db/schema/index.js';
import { canConnect, resetUarDatabase } from '../db/test-support.js';
import { withTenantTransaction } from '../db/tenant-context.js';
import { type CsvIngestJobPayload, runCsvIngestJob } from '../ingest/job.js';
import { beginSnapshotBuild } from './lifecycle.js';
import { createDrizzleIngestJobStore } from './ingest-store.js';
import { loadFinalizeInput } from './snapshot-repo.js';

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);

const tenantId = '77777777-7777-4777-8777-777777777777';
const snapshotId = '88888888-8888-4888-8888-888888888888';
const reviewerUserId = '99999999-9999-4999-8999-999999999999';

const tenantContext = {
  tenantId,
  userId: reviewerUserId,
  roles: ['admin'],
} satisfies TenantContext;

const campaign = {
  tenantId,
  campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Quarterly access review',
  snapshotId,
  snapshotLifecycle: 'frozen',
  status: 'draft',
  startsAt: '2026-01-01T00:00:00.000Z',
  dueAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

class ExpectedRowMissingError extends Error {
  override readonly name = 'ExpectedRowMissingError';

  constructor(readonly detail: string) {
    super(`Expected row missing: ${detail}`);
  }
}

describe('Drizzle ingest job store', () => {
  it.skipIf(!databaseReachable)(
    'persists CSV ingest records, freezes the existing snapshot, round-trips edge stable IDs, and reruns idempotently',
    async () => {
      await resetUarDatabase(databaseUrl);
      await migrateDatabase({ databaseUrl });
      const { client, db } = createDatabaseClient(databaseUrl, { max: 1 });

      try {
        const csvContent = await readFile(resolve(process.cwd(), '../../e2e/fixtures/access.csv'), 'utf8');
        const payload = {
          connectorId: 'manual-csv',
          applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          csvContent,
          pageSize: 2,
          schemaVersion: '1',
        } satisfies CsvIngestJobPayload;

        const firstRun = await withTenantTransaction(db, tenantId, async (tx) => {
          await tx.insert(tenants).values({ tenantId, slug: 'ingest-store', name: 'Ingest Store' });
          const build = beginSnapshotBuild(
            {
              tenantId,
              connectorId: payload.connectorId,
              createdAt: '2026-01-01T00:00:00.000Z',
              schemaVersion: payload.schemaVersion,
            },
            { createSnapshotId: () => snapshotId },
          );
          await tx.insert(snapshots).values({
            id: build.id,
            tenantId: build.tenantId,
            connectorId: build.connectorId,
            ingestionRunId: build.ingestionRunId,
            lifecycle: build.lifecycle,
            manifest: build.manifest,
            manifestHash: build.manifestHash,
          });

          const store = createDrizzleIngestJobStore({ tx, tenantId, existingSnapshotId: snapshotId });

          return runCsvIngestJob({ jobId: 'job-1', tenantContext, payload }, { store });
        });

        const firstRead = await withTenantTransaction(db, tenantId, async (tx) => {
          const [snapshot] = await tx
            .select({ lifecycle: snapshots.lifecycle })
            .from(snapshots)
            .where(eq(snapshots.id, snapshotId))
            .limit(1);
          const [nodeCount] = await tx.select({ value: count() }).from(snapshotNodes);
          const [edgeCount] = await tx.select({ value: count() }).from(snapshotEdges);
          const finalizeInput = await loadFinalizeInput(tx, tenantId, campaign);

          return {
            snapshot,
            nodeCount: expectRow(nodeCount, 'node count').value,
            edgeCount: expectRow(edgeCount, 'edge count').value,
            finalizeInput,
          };
        });

        await withTenantTransaction(db, tenantId, async (tx) => {
          const store = createDrizzleIngestJobStore({ tx, tenantId, existingSnapshotId: snapshotId });

          await runCsvIngestJob({ jobId: 'job-2', tenantContext, payload }, { store });
        });

        const secondRead = await withTenantTransaction(db, tenantId, async (tx) => {
          const [nodeCount] = await tx.select({ value: count() }).from(snapshotNodes);
          const [edgeCount] = await tx.select({ value: count() }).from(snapshotEdges);

          return {
            nodeCount: expectRow(nodeCount, 'rerun node count').value,
            edgeCount: expectRow(edgeCount, 'rerun edge count').value,
          };
        });

        expect(firstRun.snapshotId).toBe(snapshotId);
        expect(firstRead.snapshot?.lifecycle).toBe('frozen');
        expect(firstRead.nodeCount).toBeGreaterThan(0);
        expect(firstRead.edgeCount).toBeGreaterThan(0);
        expect(firstRead.finalizeInput.edges.every((edge) => edge.sourceNodeStableId.length > 0)).toBe(true);
        expect(firstRead.finalizeInput.edges.every((edge) => edge.targetNodeStableId.length > 0)).toBe(true);
        expect(secondRead).toEqual({ nodeCount: firstRead.nodeCount, edgeCount: firstRead.edgeCount });
      } finally {
        await client.end({ timeout: 1 });
        await resetUarDatabase(databaseUrl);
      }
    },
  );
});

function expectRow<T>(row: T | undefined, detail: string): T {
  if (row === undefined) {
    throw new ExpectedRowMissingError(detail);
  }

  return row;
}
