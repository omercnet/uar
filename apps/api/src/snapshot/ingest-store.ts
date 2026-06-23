import { SnapshotManifestSchema } from '@uar/core';
import { and, eq } from 'drizzle-orm';

import { ingestionObservations, ingestionRuns, snapshotEdges, snapshotNodes, snapshots } from '../db/schema/index.js';
import type { TenantDb } from '../db/tenant-context.js';
import type { IngestJobStore } from '../ingest/job.js';
import type { MaterializedSnapshot, SnapshotEdgeWrite } from './materialize.js';

export type CreateDrizzleIngestJobStoreInput = {
  readonly tx: TenantDb;
  readonly tenantId: string;
  readonly existingSnapshotId: string;
};

class ExpectedPersistenceRowMissingError extends Error {
  override readonly name = 'ExpectedPersistenceRowMissingError';

  constructor(readonly detail: string) {
    super(`Expected persistence row missing: ${detail}`);
  }
}

class SnapshotNodeResolutionError extends Error {
  override readonly name = 'SnapshotNodeResolutionError';

  constructor(readonly stableId: string) {
    super(`Snapshot node stable ID was not persisted before edge write: ${stableId}`);
  }
}

export function createDrizzleIngestJobStore({
  tx,
  tenantId,
  existingSnapshotId,
}: CreateDrizzleIngestJobStoreInput): IngestJobStore {
  return {
    async createIngestionRun(input) {
      const [row] = await tx
        .insert(ingestionRuns)
        .values({
          tenantId,
          connectorId: input.connectorId,
          status: 'running',
          startedAt: new Date(input.startedAt),
          cursor: null,
        })
        .returning({ id: ingestionRuns.id });

      return { ingestionRunId: expectRow(row, 'inserted ingestion run').id, cursor: null };
    },

    async beginSnapshot(input) {
      if (await snapshotHasLifecycle(tx, tenantId, existingSnapshotId, 'frozen')) {
        return { snapshotId: existingSnapshotId };
      }

      const manifest = SnapshotManifestSchema.parse({
        snapshotId: existingSnapshotId,
        tenantId,
        createdAt: input.createdAt,
        connectorId: input.connectorId,
        recordCounts: {},
        schemaVersion: input.schemaVersion,
      });
      const [row] = await tx
        .update(snapshots)
        .set({ connectorId: input.connectorId, ingestionRunId: input.ingestionRunId, manifest })
        .where(and(eq(snapshots.tenantId, tenantId), eq(snapshots.id, existingSnapshotId)))
        .returning({ id: snapshots.id });

      return { snapshotId: expectRow(row, 'updated snapshot build').id };
    },

    async appendObservations(input) {
      if (input.records.length === 0) {
        return;
      }

      await tx.insert(ingestionObservations).values(
        input.records.map((record) => ({
          tenantId,
          ingestionRunId: input.ingestionRunId,
          recordType: record.recordType,
          payload: record.payload,
        })),
      );
    },

    async writeSnapshotRecords(input) {
      if (await snapshotHasLifecycle(tx, tenantId, existingSnapshotId, 'frozen')) {
        return;
      }

      await writeSnapshotNodes(tx, input);
      const nodeIds = await loadNodeIdsByStableId(tx, tenantId, existingSnapshotId);
      await writeSnapshotEdges(tx, input.edges, nodeIds);
    },

    async markSnapshotReady() {
      if (await snapshotHasLifecycle(tx, tenantId, existingSnapshotId, 'ready')) {
        return;
      }
      if (await snapshotHasLifecycle(tx, tenantId, existingSnapshotId, 'frozen')) {
        return;
      }

      const [row] = await tx
        .update(snapshots)
        .set({ lifecycle: 'ready' })
        .where(and(eq(snapshots.tenantId, tenantId), eq(snapshots.id, existingSnapshotId)))
        .returning({ id: snapshots.id });

      expectRow(row, 'snapshot marked ready');
    },

    async freezeSnapshot(input) {
      if (await snapshotHasLifecycle(tx, tenantId, existingSnapshotId, 'frozen')) {
        return;
      }

      const manifest = SnapshotManifestSchema.parse(JSON.parse(input.manifestJson));
      const [row] = await tx
        .update(snapshots)
        .set({ lifecycle: 'frozen', manifestHash: input.manifestHash, manifest })
        .where(and(eq(snapshots.tenantId, tenantId), eq(snapshots.id, existingSnapshotId)))
        .returning({ id: snapshots.id });

      expectRow(row, 'snapshot frozen');
    },

    async commitCursor(input) {
      await tx
        .update(ingestionRuns)
        .set({
          cursor: toCursorRecord(input.cursor),
          status: input.cursor === null ? 'completed' : 'running',
          finishedAt: input.cursor === null ? new Date() : null,
        })
        .where(and(eq(ingestionRuns.tenantId, tenantId), eq(ingestionRuns.id, input.ingestionRunId)));
    },
  };
}

async function writeSnapshotNodes(tx: TenantDb, input: MaterializedSnapshot): Promise<void> {
  if (input.nodes.length === 0) {
    return;
  }

  await tx
    .insert(snapshotNodes)
    .values(
      input.nodes.map((node) => ({
        tenantId: node.tenantId,
        snapshotId: node.snapshotId,
        nodeType: node.nodeType,
        stableId: node.stableId,
        label: node.label,
        payload: node.payload,
      })),
    )
    .onConflictDoNothing({
      target: [snapshotNodes.tenantId, snapshotNodes.snapshotId, snapshotNodes.nodeType, snapshotNodes.stableId],
    });
}

async function writeSnapshotEdges(
  tx: TenantDb,
  edges: readonly SnapshotEdgeWrite[],
  nodeIds: ReadonlyMap<string, string>,
): Promise<void> {
  if (edges.length === 0) {
    return;
  }

  await tx
    .insert(snapshotEdges)
    .values(
      edges.map((edge) => ({
        tenantId: edge.tenantId,
        snapshotId: edge.snapshotId,
        sourceNodeId: requireNodeId(nodeIds, edge.sourceNodeStableId),
        targetNodeId: requireNodeId(nodeIds, edge.targetNodeStableId),
        edgeType: edge.edgeType,
        payload: edge.payload,
      })),
    )
    .onConflictDoNothing({
      target: [
        snapshotEdges.tenantId,
        snapshotEdges.snapshotId,
        snapshotEdges.sourceNodeId,
        snapshotEdges.targetNodeId,
        snapshotEdges.edgeType,
      ],
    });
}

async function loadNodeIdsByStableId(
  tx: TenantDb,
  tenantId: string,
  snapshotId: string,
): Promise<ReadonlyMap<string, string>> {
  const rows = await tx
    .select({ id: snapshotNodes.id, stableId: snapshotNodes.stableId })
    .from(snapshotNodes)
    .where(and(eq(snapshotNodes.tenantId, tenantId), eq(snapshotNodes.snapshotId, snapshotId)));
  const nodeIds = new Map<string, string>();

  for (const row of rows) {
    nodeIds.set(row.stableId, row.id);
  }

  return nodeIds;
}

async function snapshotHasLifecycle(
  tx: TenantDb,
  tenantId: string,
  snapshotId: string,
  lifecycle: 'ready' | 'frozen',
): Promise<boolean> {
  const [row] = await tx
    .select({ lifecycle: snapshots.lifecycle })
    .from(snapshots)
    .where(and(eq(snapshots.tenantId, tenantId), eq(snapshots.id, snapshotId)))
    .limit(1);

  return expectRow(row, 'snapshot lifecycle').lifecycle === lifecycle;
}

function requireNodeId(nodeIds: ReadonlyMap<string, string>, stableId: string): string {
  const nodeId = nodeIds.get(stableId);

  if (nodeId === undefined) {
    throw new SnapshotNodeResolutionError(stableId);
  }

  return nodeId;
}

function toCursorRecord(cursor: string | null): Record<string, unknown> | null {
  return cursor === null ? null : { value: cursor };
}

function expectRow<T>(row: T | undefined, detail: string): T {
  if (row === undefined) {
    throw new ExpectedPersistenceRowMissingError(detail);
  }

  return row;
}
