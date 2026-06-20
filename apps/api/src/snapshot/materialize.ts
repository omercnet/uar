import {
  ConnectorRecordSchema,
  finalizeSnapshotManifest,
  type ConnectorRecord,
  type FinalizedSnapshotManifest,
  type SnapshotManifest,
} from '@uar/core';

export interface SnapshotNodeWrite {
  readonly tenantId: string;
  readonly snapshotId: string;
  readonly nodeType: string;
  readonly stableId: string;
  readonly label: string;
  readonly payload: Record<string, unknown>;
}

export interface SnapshotEdgeWrite {
  readonly tenantId: string;
  readonly snapshotId: string;
  readonly sourceNodeStableId: string;
  readonly targetNodeStableId: string;
  readonly edgeType: string;
  readonly payload: Record<string, unknown>;
}

export interface MaterializationRecordCounts extends Record<string, number> {
  readonly ingestionObservations: number;
  readonly snapshotEdges: number;
  readonly snapshotNodes: number;
}

export interface MaterializedSnapshot {
  readonly nodes: readonly SnapshotNodeWrite[];
  readonly edges: readonly SnapshotEdgeWrite[];
  readonly recordCounts: MaterializationRecordCounts;
}

export interface MaterializeConnectorRecordsInput {
  readonly tenantId: string;
  readonly snapshotId: string;
  readonly records: readonly ConnectorRecord[];
}

export interface BuildFrozenSnapshotManifestInput {
  readonly tenantId: string;
  readonly snapshotId: string;
  readonly connectorId: string;
  readonly createdAt: string;
  readonly schemaVersion: string;
  readonly recordCounts: MaterializationRecordCounts;
}

type MaterializedRecord = {
  readonly nodes: readonly SnapshotNodeWrite[];
  readonly edges: readonly SnapshotEdgeWrite[];
};

export function materializeConnectorRecords(
  input: MaterializeConnectorRecordsInput,
): MaterializedSnapshot {
  const nodes = new Map<string, SnapshotNodeWrite>();
  const edges = new Map<string, SnapshotEdgeWrite>();

  for (const rawRecord of input.records) {
    const record = ConnectorRecordSchema.parse(rawRecord);
    const materialized = materializeRecord(input.tenantId, input.snapshotId, record);

    for (const node of materialized.nodes) {
      nodes.set(nodeKey(node), node);
    }
    for (const edge of materialized.edges) {
      edges.set(edgeKey(edge), edge);
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    recordCounts: {
      ingestionObservations: input.records.length,
      snapshotEdges: edges.size,
      snapshotNodes: nodes.size,
    },
  };
}

export function buildFrozenSnapshotManifest(
  input: BuildFrozenSnapshotManifestInput,
): FinalizedSnapshotManifest {
  const manifest = {
    snapshotId: input.snapshotId,
    tenantId: input.tenantId,
    createdAt: input.createdAt,
    connectorId: input.connectorId,
    recordCounts: input.recordCounts,
    schemaVersion: input.schemaVersion,
  } satisfies SnapshotManifest;

  return finalizeSnapshotManifest(manifest);
}

function materializeRecord(tenantId: string, snapshotId: string, record: ConnectorRecord): MaterializedRecord {
  const userNode = toUserNode(tenantId, snapshotId, record);

  if (record.recordType !== 'access_grant') {
    return { nodes: [userNode], edges: [] };
  }

  const grantNode = toGrantNode(tenantId, snapshotId, record);

  return {
    nodes: [userNode, grantNode],
    edges: [toGrantEdge(tenantId, snapshotId, userNode, grantNode, record)],
  };
}

function toUserNode(tenantId: string, snapshotId: string, record: ConnectorRecord): SnapshotNodeWrite {
  const displayName = readPayloadString(record.payload, 'displayName');
  const email = readPayloadString(record.payload, 'email');

  return {
    tenantId,
    snapshotId,
    nodeType: 'user',
    stableId: `user:${record.externalAccountId}`,
    label: displayName ?? email ?? record.externalAccountId,
    payload: record.payload,
  };
}

function toGrantNode(tenantId: string, snapshotId: string, record: ConnectorRecord): SnapshotNodeWrite {
  const grantId = readPayloadString(record.payload, 'grantId') ?? `${record.applicationId}:${record.externalAccountId}`;
  const accessId = readPayloadString(record.payload, 'accessId');
  const accessLabel = readPayloadString(record.payload, 'accessLabel');

  return {
    tenantId,
    snapshotId,
    nodeType: 'grant',
    stableId: `grant:${grantId}`,
    label: accessLabel ?? accessId ?? grantId,
    payload: record.payload,
  };
}

function toGrantEdge(
  tenantId: string,
  snapshotId: string,
  userNode: SnapshotNodeWrite,
  grantNode: SnapshotNodeWrite,
  record: ConnectorRecord,
): SnapshotEdgeWrite {
  return {
    tenantId,
    snapshotId,
    sourceNodeStableId: userNode.stableId,
    targetNodeStableId: grantNode.stableId,
    edgeType: 'has_grant',
    payload: {
      applicationId: record.applicationId,
      observedAt: record.observedAt,
      recordType: record.recordType,
    },
  };
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];

  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nodeKey(node: SnapshotNodeWrite): string {
  return `${node.nodeType}:${node.stableId}`;
}

function edgeKey(edge: SnapshotEdgeWrite): string {
  return `${edge.sourceNodeStableId}:${edge.targetNodeStableId}:${edge.edgeType}`;
}
