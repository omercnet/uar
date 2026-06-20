import type { TenantContext } from '@uar/core';
import { MANUAL_CSV_CONNECTOR_ID } from '@uar/connectors';
import type { MaterializedSnapshot, SnapshotEdgeWrite, SnapshotNodeWrite } from '@uar/api';
import { describe, expect, it } from 'vitest';

import type { TenantJobHandler, TenantJobHandlerInput } from '../queue.js';
import {
  INGEST_CONNECTOR_JOB_NAME,
  type CsvIngestJobPayload,
  type IngestJobStore,
  type RegisterCsvIngestJobDependencies,
  registerCsvIngestJob,
  runCsvIngestJob,
} from './ingest.js';

const tenantContext = {
  tenantId: 'tenant_acme',
  userId: 'user_ada',
  roles: ['admin'],
} satisfies TenantContext;

const accessCsv = [
  'externalAccountId,email,displayName,grantId,accessId,accessLabel,observedAt',
  'acct_ada,ada@example.test,Ada Lovelace,grant_payroll_admin,role_admin,Payroll Admin,2026-06-08T12:00:00.000Z',
  'acct_grace,grace@example.test,Grace Hopper,grant_payroll_auditor,role_auditor,Payroll Auditor,2026-06-08T12:01:00.000Z',
].join('\n');

const payload = {
  connectorId: MANUAL_CSV_CONNECTOR_ID,
  applicationId: 'app_payroll',
  csvContent: accessCsv,
  pageSize: 1,
  schemaVersion: '1',
} satisfies CsvIngestJobPayload;

type ObservationBatch = {
  readonly cursor: string | null;
  readonly recordsCount: number;
};

class FakeIngestStore implements IngestJobStore {
  readonly appendedBatches: ObservationBatch[] = [];
  readonly committedCursors: Array<string | null> = [];
  readonly lifecycleTransitions: string[] = [];
  readonly nodes = new Map<string, SnapshotNodeWrite>();
  readonly edges = new Map<string, SnapshotEdgeWrite>();
  frozenManifestHash: string | null = null;

  constructor(private readonly failOnSnapshotWriteBatch: number | null = null) {}

  async createIngestionRun(): Promise<{ readonly ingestionRunId: string; readonly cursor: string | null }> {
    return { ingestionRunId: 'run-1', cursor: null };
  }

  async beginSnapshot(): Promise<{ readonly snapshotId: string }> {
    this.lifecycleTransitions.push('building');

    return { snapshotId: 'snapshot-1' };
  }

  async appendObservations(input: {
    readonly cursor: string | null;
    readonly records: readonly unknown[];
  }): Promise<void> {
    this.appendedBatches.push({ cursor: input.cursor, recordsCount: input.records.length });
  }

  async writeSnapshotRecords(input: MaterializedSnapshot): Promise<void> {
    if (this.failOnSnapshotWriteBatch === this.appendedBatches.length) {
      throw new Error('simulated materialization crash');
    }

    for (const node of input.nodes) {
      this.nodes.set(`${node.nodeType}:${node.stableId}`, node);
    }
    for (const edge of input.edges) {
      this.edges.set(`${edge.sourceNodeStableId}:${edge.targetNodeStableId}:${edge.edgeType}`, edge);
    }
  }

  async markSnapshotReady(): Promise<void> {
    this.lifecycleTransitions.push('ready');
  }

  async freezeSnapshot(input: { readonly manifestHash: string }): Promise<void> {
    this.lifecycleTransitions.push('frozen');
    this.frozenManifestHash = input.manifestHash;
  }

  async commitCursor(input: { readonly cursor: string | null }): Promise<void> {
    this.committedCursors.push(input.cursor);
  }
}

class FakeTenantQueue {
  registeredName: string | null = null;
  private handler: TenantJobHandler<CsvIngestJobPayload> | null = null;

  async work(
    name: string,
    handler: TenantJobHandler<CsvIngestJobPayload>,
  ): Promise<string> {
    this.registeredName = name;
    this.handler = handler;

    return `worker-${name}`;
  }

  async run(input: TenantJobHandlerInput<CsvIngestJobPayload>): Promise<void> {
    if (this.handler === null) {
      throw new Error('No ingestion handler registered');
    }

    await this.handler(input);
  }
}

function createHandlerInput(): TenantJobHandlerInput<CsvIngestJobPayload> {
  return {
    jobId: 'job-1',
    tenantContext,
    payload,
  };
}

describe('CSV ingestion worker job', () => {
  it('T9-W1 persists connector observations, materializes records, and freezes the snapshot', async () => {
    const store = new FakeIngestStore();

    const result = await runCsvIngestJob(createHandlerInput(), { store });

    expect(result).toEqual({
      ingestionRunId: 'run-1',
      snapshotId: 'snapshot-1',
      committedCursor: null,
      recordCounts: {
        ingestionObservations: 2,
        snapshotEdges: 2,
        snapshotNodes: 4,
      },
    });
    expect(store.appendedBatches).toEqual([
      { cursor: '1', recordsCount: 1 },
      { cursor: null, recordsCount: 1 },
    ]);
    expect([...store.nodes.values()].map((node) => node.nodeType).sort()).toEqual([
      'grant',
      'grant',
      'user',
      'user',
    ]);
    expect(store.edges).toHaveLength(2);
    expect(store.lifecycleTransitions).toEqual(['building', 'ready', 'frozen']);
    expect(store.committedCursors).toEqual(['1', null]);
    expect(store.frozenManifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('T9-W2 does not commit a page cursor when materialization fails mid-iteration', async () => {
    const store = new FakeIngestStore(2);

    await expect(runCsvIngestJob(createHandlerInput(), { store })).rejects.toThrow(
      'simulated materialization crash',
    );

    expect(store.appendedBatches).toEqual([
      { cursor: '1', recordsCount: 1 },
      { cursor: null, recordsCount: 1 },
    ]);
    expect(store.committedCursors).toEqual(['1']);
    expect(store.lifecycleTransitions).toEqual(['building']);
    expect(store.frozenManifestHash).toBeNull();
  });

  it('T9-W3 registers ingestion as a tenant-scoped worker job', async () => {
    const store = new FakeIngestStore();
    const queue = new FakeTenantQueue();
    const dependencies = { store } satisfies RegisterCsvIngestJobDependencies;

    await registerCsvIngestJob(queue, dependencies);
    await queue.run(createHandlerInput());

    expect(queue.registeredName).toBe(INGEST_CONNECTOR_JOB_NAME);
    expect(store.lifecycleTransitions).toEqual(['building', 'ready', 'frozen']);
  });
});
