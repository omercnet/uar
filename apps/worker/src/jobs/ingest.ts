import type { ConnectorRecord, TenantContext } from '@uar/core';
import { MANUAL_CSV_CONNECTOR_ID, createCsvConnector } from '@uar/connectors';
import {
  buildFrozenSnapshotManifest,
  materializeConnectorRecords,
  type MaterializedSnapshot,
  type MaterializationRecordCounts,
} from '@uar/api';
import { z } from 'zod';

import type { TenantJobHandler, TenantJobHandlerInput } from '../queue.js';

const nonEmptyStringSchema = z.string().min(1);

export const INGEST_CONNECTOR_JOB_NAME = 'connector.ingest' as const;

export const CsvIngestJobPayloadSchema = z.object({
  connectorId: z.literal(MANUAL_CSV_CONNECTOR_ID),
  applicationId: nonEmptyStringSchema,
  csvContent: nonEmptyStringSchema,
  pageSize: z.number().int().positive().optional(),
  schemaVersion: nonEmptyStringSchema,
});

export type CsvIngestJobPayload = Readonly<z.infer<typeof CsvIngestJobPayloadSchema>>;

export interface IngestJobStore {
  createIngestionRun(input: {
    readonly tenantContext: TenantContext;
    readonly connectorId: string;
    readonly startedAt: string;
  }): Promise<{ readonly ingestionRunId: string; readonly cursor: string | null }>;
  beginSnapshot(input: {
    readonly tenantContext: TenantContext;
    readonly connectorId: string;
    readonly ingestionRunId: string;
    readonly createdAt: string;
    readonly schemaVersion: string;
  }): Promise<{ readonly snapshotId: string }>;
  appendObservations(input: {
    readonly tenantContext: TenantContext;
    readonly ingestionRunId: string;
    readonly cursor: string | null;
    readonly records: readonly ConnectorRecord[];
  }): Promise<void>;
  writeSnapshotRecords(input: MaterializedSnapshot): Promise<void>;
  markSnapshotReady(input: {
    readonly tenantContext: TenantContext;
    readonly snapshotId: string;
  }): Promise<void>;
  freezeSnapshot(input: {
    readonly tenantContext: TenantContext;
    readonly snapshotId: string;
    readonly manifestHash: string;
    readonly manifestJson: string;
  }): Promise<void>;
  commitCursor(input: {
    readonly tenantContext: TenantContext;
    readonly ingestionRunId: string;
    readonly cursor: string | null;
  }): Promise<void>;
}

export interface RegisterCsvIngestJobDependencies {
  readonly store: IngestJobStore;
}

export interface CsvIngestQueue {
  work(
    name: typeof INGEST_CONNECTOR_JOB_NAME,
    handler: TenantJobHandler<CsvIngestJobPayload, CsvIngestJobResult>,
  ): Promise<string>;
}

export interface CsvIngestJobResult {
  readonly ingestionRunId: string;
  readonly snapshotId: string;
  readonly committedCursor: string | null;
  readonly recordCounts: MaterializationRecordCounts;
}

export async function registerCsvIngestJob(
  queue: CsvIngestQueue,
  dependencies: RegisterCsvIngestJobDependencies,
): Promise<string> {
  return queue.work(INGEST_CONNECTOR_JOB_NAME, (input) => runCsvIngestJob(input, dependencies));
}

export async function runCsvIngestJob(
  input: TenantJobHandlerInput<CsvIngestJobPayload>,
  dependencies: RegisterCsvIngestJobDependencies,
): Promise<CsvIngestJobResult> {
  const payload = CsvIngestJobPayloadSchema.parse(input.payload);
  const createdAt = new Date().toISOString();
  const ingestionRun = await dependencies.store.createIngestionRun({
    tenantContext: input.tenantContext,
    connectorId: payload.connectorId,
    startedAt: createdAt,
  });
  const snapshot = await dependencies.store.beginSnapshot({
    tenantContext: input.tenantContext,
    connectorId: payload.connectorId,
    ingestionRunId: ingestionRun.ingestionRunId,
    createdAt,
    schemaVersion: payload.schemaVersion,
  });
  const connector = createCsvConnector({
    tenantId: input.tenantContext.tenantId,
    applicationId: payload.applicationId,
    csvContent: payload.csvContent,
    pageSize: payload.pageSize,
  });
  const counts = createEmptyRecordCounts();
  let committedCursor = ingestionRun.cursor;

  for await (const page of connector.sync({ cursor: ingestionRun.cursor })) {
    await dependencies.store.appendObservations({
      tenantContext: input.tenantContext,
      ingestionRunId: ingestionRun.ingestionRunId,
      cursor: page.cursor,
      records: page.records,
    });
    const materialized = materializeConnectorRecords({
      tenantId: input.tenantContext.tenantId,
      snapshotId: snapshot.snapshotId,
      records: page.records,
    });

    await dependencies.store.writeSnapshotRecords(materialized);
    await dependencies.store.commitCursor({
      tenantContext: input.tenantContext,
      ingestionRunId: ingestionRun.ingestionRunId,
      cursor: page.cursor,
    });
    committedCursor = page.cursor;
    addRecordCounts(counts, materialized.recordCounts);
  }

  const finalized = buildFrozenSnapshotManifest({
    tenantId: input.tenantContext.tenantId,
    snapshotId: snapshot.snapshotId,
    connectorId: payload.connectorId,
    createdAt,
    schemaVersion: payload.schemaVersion,
    recordCounts: counts,
  });

  await dependencies.store.markSnapshotReady({
    tenantContext: input.tenantContext,
    snapshotId: snapshot.snapshotId,
  });
  await dependencies.store.freezeSnapshot({
    tenantContext: input.tenantContext,
    snapshotId: snapshot.snapshotId,
    manifestHash: finalized.manifestHash,
    manifestJson: finalized.manifestJson,
  });

  return {
    ingestionRunId: ingestionRun.ingestionRunId,
    snapshotId: snapshot.snapshotId,
    committedCursor,
    recordCounts: counts,
  };
}

function createEmptyRecordCounts(): MaterializationRecordCounts {
  return {
    ingestionObservations: 0,
    snapshotEdges: 0,
    snapshotNodes: 0,
  };
}

function addRecordCounts(
  target: {
    ingestionObservations: number;
    snapshotEdges: number;
    snapshotNodes: number;
  },
  next: MaterializationRecordCounts,
): void {
  target.ingestionObservations += next.ingestionObservations;
  target.snapshotEdges += next.snapshotEdges;
  target.snapshotNodes += next.snapshotNodes;
}
