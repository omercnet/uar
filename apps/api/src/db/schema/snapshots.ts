import { SNAPSHOT_LIFECYCLES, type SnapshotManifest } from '@uar/core';
import { foreignKey, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { ingestionRuns } from './ingestion_runs.js';
import { tenants } from './tenants.js';

export const snapshotLifecycleEnum = pgEnum('snapshot_lifecycle', SNAPSHOT_LIFECYCLES);

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    connectorId: text('connector_id').notNull(),
    ingestionRunId: uuid('ingestion_run_id'),
    lifecycle: snapshotLifecycleEnum('lifecycle').default('building').notNull(),
    manifest: jsonb('manifest').$type<SnapshotManifest>().notNull(),
    manifestHash: text('manifest_hash'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'snapshots_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.ingestionRunId],
      foreignColumns: [ingestionRuns.tenantId, ingestionRuns.id],
      name: 'snapshots_ingestion_run_fk',
    }),
    unique('snapshots_tenant_id_id_unique').on(table.tenantId, table.id),
    index('snapshots_tenant_id_idx').on(table.tenantId),
    index('snapshots_tenant_connector_idx').on(table.tenantId, table.connectorId),
  ],
);

export const snapshotNodes = pgTable(
  'snapshot_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    nodeType: text('node_type').notNull(),
    stableId: text('stable_id').notNull(),
    label: text('label').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'snapshot_nodes_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.snapshotId],
      foreignColumns: [snapshots.tenantId, snapshots.id],
      name: 'snapshot_nodes_snapshot_fk',
    }),
    unique('snapshot_nodes_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('snapshot_nodes_tenant_snapshot_id_id_unique').on(table.tenantId, table.snapshotId, table.id),
    unique('snapshot_nodes_tenant_snapshot_stable_unique').on(
      table.tenantId,
      table.snapshotId,
      table.nodeType,
      table.stableId,
    ),
    index('snapshot_nodes_tenant_id_idx').on(table.tenantId),
    index('snapshot_nodes_snapshot_id_idx').on(table.tenantId, table.snapshotId),
  ],
);

export const snapshotEdges = pgTable(
  'snapshot_edges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    sourceNodeId: uuid('source_node_id').notNull(),
    targetNodeId: uuid('target_node_id').notNull(),
    edgeType: text('edge_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'snapshot_edges_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.snapshotId],
      foreignColumns: [snapshots.tenantId, snapshots.id],
      name: 'snapshot_edges_snapshot_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.snapshotId, table.sourceNodeId],
      foreignColumns: [snapshotNodes.tenantId, snapshotNodes.snapshotId, snapshotNodes.id],
      name: 'snapshot_edges_source_node_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.snapshotId, table.targetNodeId],
      foreignColumns: [snapshotNodes.tenantId, snapshotNodes.snapshotId, snapshotNodes.id],
      name: 'snapshot_edges_target_node_fk',
    }),
    unique('snapshot_edges_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('snapshot_edges_tenant_snapshot_edge_unique').on(
      table.tenantId,
      table.snapshotId,
      table.sourceNodeId,
      table.targetNodeId,
      table.edgeType,
    ),
    index('snapshot_edges_tenant_id_idx').on(table.tenantId),
    index('snapshot_edges_snapshot_id_idx').on(table.tenantId, table.snapshotId),
  ],
);
