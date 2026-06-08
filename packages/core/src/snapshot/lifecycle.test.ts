import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { SnapshotManifest } from './manifest.js';
import {
  SNAPSHOT_LIFECYCLES,
  assertSnapshotLifecycleTransition,
  finalizeSnapshotManifest,
  isAllowedSnapshotLifecycleTransition,
} from './lifecycle.js';

const manifest = {
  snapshotId: 'snapshot-1',
  tenantId: 'tenant-1',
  createdAt: '2026-01-02T03:04:05.000Z',
  connectorId: 'manual-csv',
  recordCounts: {
    userIdentity: 1,
    accessGrant: 2,
  },
  schemaVersion: '1',
} satisfies SnapshotManifest;

describe('snapshot lifecycle', () => {
  it('T4-C1 defines the only allowed lifecycle order', () => {
    expect(SNAPSHOT_LIFECYCLES).toEqual(['building', 'ready', 'frozen']);

    expect(isAllowedSnapshotLifecycleTransition('building', 'ready')).toBe(true);
    expect(isAllowedSnapshotLifecycleTransition('ready', 'frozen')).toBe(true);
    expect(isAllowedSnapshotLifecycleTransition('building', 'frozen')).toBe(false);
    expect(isAllowedSnapshotLifecycleTransition('ready', 'building')).toBe(false);
    expect(isAllowedSnapshotLifecycleTransition('frozen', 'ready')).toBe(false);
  });

  it('T4-C2 rejects skipped or regressive lifecycle transitions', () => {
    expect(() => assertSnapshotLifecycleTransition('building', 'ready')).not.toThrow();
    expect(() => assertSnapshotLifecycleTransition('ready', 'frozen')).not.toThrow();

    expect(() => assertSnapshotLifecycleTransition('building', 'frozen')).toThrow(
      'Invalid snapshot lifecycle transition: building → frozen',
    );
    expect(() => assertSnapshotLifecycleTransition('frozen', 'ready')).toThrow(
      'Invalid snapshot lifecycle transition: frozen → ready',
    );
  });

  it('T4-C3 finalizes a manifest with deterministic SHA-256 evidence', () => {
    const finalized = finalizeSnapshotManifest(manifest);
    const canonicalManifest =
      '{"connectorId":"manual-csv","createdAt":"2026-01-02T03:04:05.000Z","recordCounts":{"accessGrant":2,"userIdentity":1},"schemaVersion":"1","snapshotId":"snapshot-1","tenantId":"tenant-1"}';
    const expectedHash = createHash('sha256').update(canonicalManifest).digest('hex');

    expect(finalized.lifecycle).toBe('frozen');
    expect(finalized.manifest).toEqual(manifest);
    expect(finalized.manifestJson).toBe(canonicalManifest);
    expect(finalized.manifestHash).toBe(expectedHash);
    expect(finalized.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
