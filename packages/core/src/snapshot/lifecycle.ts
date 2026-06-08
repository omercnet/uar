import { createHash } from 'node:crypto';

import { z } from 'zod';

import { SnapshotManifestSchema, type SnapshotManifest } from './manifest.js';

export const SNAPSHOT_LIFECYCLES = ['building', 'ready', 'frozen'] as const;

export const SnapshotLifecycleSchema = z.enum(SNAPSHOT_LIFECYCLES);
export type SnapshotLifecycle = z.infer<typeof SnapshotLifecycleSchema>;

const allowedTransitions: Record<SnapshotLifecycle, readonly SnapshotLifecycle[]> = {
  building: ['building', 'ready'],
  ready: ['ready', 'frozen'],
  frozen: ['frozen'],
};

export interface FinalizedSnapshotManifest {
  readonly lifecycle: Extract<SnapshotLifecycle, 'frozen'>;
  readonly manifest: SnapshotManifest;
  readonly manifestJson: string;
  readonly manifestHash: string;
}

export function isAllowedSnapshotLifecycleTransition(
  from: SnapshotLifecycle,
  to: SnapshotLifecycle,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertSnapshotLifecycleTransition(from: SnapshotLifecycle, to: SnapshotLifecycle): void {
  if (!isAllowedSnapshotLifecycleTransition(from, to)) {
    throw new Error(`Invalid snapshot lifecycle transition: ${from} → ${to}`);
  }
}

export function finalizeSnapshotManifest(manifest: SnapshotManifest): FinalizedSnapshotManifest {
  const parsedManifest = SnapshotManifestSchema.parse(manifest);
  const manifestJson = canonicalSnapshotManifestJson(parsedManifest);
  const manifestHash = createHash('sha256').update(manifestJson).digest('hex');

  return {
    lifecycle: 'frozen',
    manifest: parsedManifest,
    manifestJson,
    manifestHash,
  };
}

export function canonicalSnapshotManifestJson(manifest: SnapshotManifest): string {
  return canonicalJson(SnapshotManifestSchema.parse(manifest));
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error('Cannot canonicalize undefined values');
  }

  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new Error('Cannot canonicalize non-JSON primitive');
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalJson(nestedValue)}`)
    .join(',')}}`;
}
