import { randomUUID } from 'node:crypto';

import { SnapshotManifestSchema, type SnapshotLifecycle, type SnapshotManifest } from '@uar/core';

export interface BeginSnapshotBuildInput {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly createdAt: string;
  readonly schemaVersion: string;
  readonly ingestionRunId?: string | null;
  readonly recordCounts?: Record<string, number>;
}

export interface BeginSnapshotBuildOptions {
  readonly createSnapshotId?: () => string;
}

export interface SnapshotBuildRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly connectorId: string;
  readonly ingestionRunId: string | null;
  readonly lifecycle: Extract<SnapshotLifecycle, 'building'>;
  readonly manifest: SnapshotManifest;
  readonly manifestHash: null;
}

export function beginSnapshotBuild(
  input: BeginSnapshotBuildInput,
  options: BeginSnapshotBuildOptions = {},
): SnapshotBuildRecord {
  const snapshotId = (options.createSnapshotId ?? randomUUID)();
  const manifest = SnapshotManifestSchema.parse({
    snapshotId,
    tenantId: input.tenantId,
    createdAt: input.createdAt,
    connectorId: input.connectorId,
    recordCounts: { ...(input.recordCounts ?? {}) },
    schemaVersion: input.schemaVersion,
  });

  return {
    id: snapshotId,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    ingestionRunId: input.ingestionRunId ?? null,
    lifecycle: 'building',
    manifest,
    manifestHash: null,
  };
}
