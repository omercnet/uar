import {
  ConnectorErrorSchema,
  SyncResultSchema,
  contractVersion,
  type CapabilityDescriptor,
  type ConnectorError,
  type ConnectorRecord,
  type SyncResult,
} from '@uar/core';

const provenance = 'mocked-descope-outbound-apps-spike';
const accessGrantProbeFailureReason =
  'Hermetic spike fixture does not prove a stable app-level access grant shape.';

export const DESCOPE_OUTBOUND_APPS_CONNECTOR_ID = 'descope-outbound-apps';

export const DESCOPE_OUTBOUND_APPS_DESCRIPTOR = {
  contractVersion,
  connectorId: DESCOPE_OUTBOUND_APPS_CONNECTOR_ID,
  capabilities: {
    users: true,
    groups: true,
    roles: true,
    permissions: false,
    access_grants: false,
    owners: false,
    revoke: false,
    evidence_links: true,
  },
} satisfies CapabilityDescriptor;

export interface DescopeOutboundAppsGroup {
  readonly id: string;
  readonly name: string;
}

export interface DescopeOutboundAppProbe {
  readonly id: string;
  readonly name: string;
}

export interface DescopeOutboundAppsUser {
  readonly id: string;
  readonly email: string;
  readonly displayName?: string;
  readonly disabled?: boolean;
  readonly deleted?: boolean;
  readonly groups?: readonly DescopeOutboundAppsGroup[];
  readonly roles?: readonly string[];
  readonly outboundApps?: readonly DescopeOutboundAppProbe[];
}

export interface DescopeOutboundAppsPage {
  readonly cursor: string | null;
  readonly users: readonly DescopeOutboundAppsUser[];
}

export interface DescopeOutboundAppsClient {
  listOutboundAppAssignments(input: {
    readonly cursor: string | null;
  }): Promise<DescopeOutboundAppsPage>;
}

export interface DescopeOutboundAppsConnectorConfig {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly observedAt?: string;
  readonly client: DescopeOutboundAppsClient;
}

export interface DescopeOutboundAppsSyncInput {
  readonly cursor: string | null;
}

export interface DescopeOutboundAppsConnector {
  readonly descriptor: CapabilityDescriptor;
  sync(input: DescopeOutboundAppsSyncInput): Promise<SyncResult>;
}

export class DescopeOutboundAppsConnectorError extends Error {
  readonly connectorError: ConnectorError;

  constructor(connectorError: ConnectorError) {
    super(toErrorMessage(connectorError));
    this.name = 'DescopeOutboundAppsConnectorError';
    this.connectorError = connectorError;
  }
}

export function createDescopeOutboundAppsConnector(
  config: DescopeOutboundAppsConnectorConfig,
): DescopeOutboundAppsConnector {
  return {
    descriptor: DESCOPE_OUTBOUND_APPS_DESCRIPTOR,
    sync: async ({ cursor }) => {
      try {
        const page = await config.client.listOutboundAppAssignments({ cursor });
        const result = {
          cursor: page.cursor,
          records: page.users.flatMap((user) => toConnectorRecords(config, user)),
        } satisfies SyncResult;

        return SyncResultSchema.parse(result);
      } catch (error) {
        throw new DescopeOutboundAppsConnectorError(mapDescopeOutboundAppsError(error));
      }
    },
  };
}

export function mapDescopeOutboundAppsError(error: unknown): ConnectorError {
  if (isRateLimitError(error)) {
    return ConnectorErrorSchema.parse({
      kind: 'rate_limit',
      retryAfterMs: readRetryAfterMs(error),
    });
  }

  if (isRefreshFailure(error)) {
    return ConnectorErrorSchema.parse({
      kind: 'refresh_failure',
      reason: readRefreshReason(error),
    });
  }

  return ConnectorErrorSchema.parse({
    kind: 'unknown',
    message: readUnknownMessage(error),
  });
}

function toConnectorRecords(
  config: DescopeOutboundAppsConnectorConfig,
  user: DescopeOutboundAppsUser,
): ConnectorRecord[] {
  return [
    toUserRecord(config, user),
    ...toGroupMembershipRecords(config, user),
    ...toRoleMembershipRecords(config, user),
    ...toOutboundAppProbeRecords(config, user),
  ];
}

function toUserRecord(
  config: DescopeOutboundAppsConnectorConfig,
  user: DescopeOutboundAppsUser,
): ConnectorRecord {
  return {
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    externalAccountId: toExternalAccountId(user),
    recordType: 'user',
    payload: {
      externalUserId: user.id,
      email: user.email,
      displayName: user.displayName ?? user.email,
      disabled: user.disabled ?? false,
      deleted: user.deleted ?? false,
      provenance,
    },
    observedAt: readObservedAt(config),
  };
}

function toGroupMembershipRecords(
  config: DescopeOutboundAppsConnectorConfig,
  user: DescopeOutboundAppsUser,
): ConnectorRecord[] {
  return (user.groups ?? []).map((group) => ({
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    externalAccountId: toExternalAccountId(user),
    recordType: 'group_membership',
    payload: {
      externalUserId: user.id,
      groupId: group.id,
      groupName: group.name,
      provenance,
    },
    observedAt: readObservedAt(config),
  }));
}

function toRoleMembershipRecords(
  config: DescopeOutboundAppsConnectorConfig,
  user: DescopeOutboundAppsUser,
): ConnectorRecord[] {
  return (user.roles ?? []).map((roleName) => ({
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    externalAccountId: toExternalAccountId(user),
    recordType: 'role_membership',
    payload: {
      externalUserId: user.id,
      roleName,
      provenance,
    },
    observedAt: readObservedAt(config),
  }));
}

function toOutboundAppProbeRecords(
  config: DescopeOutboundAppsConnectorConfig,
  user: DescopeOutboundAppsUser,
): ConnectorRecord[] {
  return (user.outboundApps ?? []).map((outboundApp) => ({
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    externalAccountId: toExternalAccountId(user),
    recordType: 'outbound_app_assignment_probe',
    payload: {
      externalUserId: user.id,
      outboundAppId: outboundApp.id,
      outboundAppName: outboundApp.name,
      grantObserved: false,
      reason: accessGrantProbeFailureReason,
      provenance,
    },
    observedAt: readObservedAt(config),
  }));
}

function toExternalAccountId(user: DescopeOutboundAppsUser): string {
  return `descope_user_${user.id}`;
}

function readObservedAt(config: DescopeOutboundAppsConnectorConfig): string {
  return config.observedAt ?? new Date().toISOString();
}

function isRateLimitError(error: unknown): error is { status: number; retryAfterMs?: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status === 429
  );
}

function readRetryAfterMs(error: { retryAfterMs?: unknown }): number {
  return typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 60_000;
}

function isRefreshFailure(
  error: unknown,
): error is { code?: string; reason?: string; message?: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const codeMentionsRefresh =
    'code' in error && typeof error.code === 'string' && error.code.includes('refresh');
  const reasonMentionsRefresh =
    'reason' in error && typeof error.reason === 'string' && error.reason.includes('refresh');
  const messageMentionsRefresh =
    'message' in error && typeof error.message === 'string' && error.message.includes('refresh');

  return codeMentionsRefresh || reasonMentionsRefresh || messageMentionsRefresh;
}

function readRefreshReason(error: { code?: string; reason?: string; message?: string }): string {
  return error.reason ?? error.message ?? error.code ?? 'refresh failed';
}

function readUnknownMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message;
  }

  return 'Descope Outbound Apps connector failed';
}

function toErrorMessage(connectorError: ConnectorError): string {
  switch (connectorError.kind) {
    case 'rate_limit':
      return `Descope Outbound Apps rate limited for ${connectorError.retryAfterMs}ms`;
    case 'refresh_failure':
      return connectorError.reason;
    case 'unknown':
      return connectorError.message;
  }
}
