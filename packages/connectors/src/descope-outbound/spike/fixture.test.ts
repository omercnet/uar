import { readFileSync } from 'node:fs';

import {
  CapabilityDescriptorSchema,
  ConnectorErrorSchema,
  ConnectorRecordSchema,
  SnapshotManifestSchema,
  SyncResultSchema,
  type ConnectorError,
} from '@uar/core';
import { describe, expect, it } from 'vitest';

import {
  DESCOPE_OUTBOUND_APPS_DESCRIPTOR,
  DescopeOutboundAppsConnectorError,
  createDescopeOutboundAppsConnector,
} from '../index.js';

const observedAt = '2026-06-08T12:00:00.000Z';

function isFixture(value: unknown): value is { manifest: unknown; syncResult: unknown } {
  return typeof value === 'object' && value !== null && 'manifest' in value && 'syncResult' in value;
}

function loadFixture(): { manifest: unknown; syncResult: unknown } {
  const rawFixture: unknown = JSON.parse(
    readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'),
  );

  if (!isFixture(rawFixture)) {
    throw new Error('Descope spike fixture must include manifest and syncResult');
  }

  return rawFixture;
}

function createHappyConnector() {
  return createDescopeOutboundAppsConnector({
    tenantId: 'tenant_acme',
    applicationId: 'app_descope',
    observedAt,
    client: {
      listOutboundAppAssignments: async () => ({
        cursor: null,
        users: [
          {
            id: 'u_ada',
            email: 'ada@example.com',
            displayName: 'Ada Lovelace',
            disabled: false,
            deleted: false,
            groups: [{ id: 'grp_engineering', name: 'Engineering' }],
            outboundApps: [{ id: 'descope_outbound_app_github', name: 'GitHub' }],
          },
        ],
      }),
    },
  });
}

async function expectMappedConnectorError(
  runSync: () => Promise<unknown>,
  expectedConnectorError: ConnectorError,
): Promise<void> {
  try {
    await runSync();
  } catch (error) {
    expect(error).toBeInstanceOf(DescopeOutboundAppsConnectorError);

    if (error instanceof DescopeOutboundAppsConnectorError) {
      expect(ConnectorErrorSchema.parse(error.connectorError)).toEqual(expectedConnectorError);
      return;
    }
  }

  throw new Error('Expected sync() to map the Descope failure to ConnectorError');
}

describe('Descope Outbound Apps spike connector', () => {
  it('exposes a valid CapabilityDescriptor', () => {
    expect(CapabilityDescriptorSchema.parse(DESCOPE_OUTBOUND_APPS_DESCRIPTOR)).toEqual({
      contractVersion: '1.0.0',
      connectorId: 'descope-outbound-apps',
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
    });
  });

  it('syncs ConnectorRecords that match the committed fixture and core schema', async () => {
    const fixture = loadFixture();
    const expectedSyncResult = SyncResultSchema.parse(fixture.syncResult);

    expect(() => SnapshotManifestSchema.parse(fixture.manifest)).not.toThrow();

    const connector = createHappyConnector();
    const syncResult = await connector.sync({ cursor: null });

    expect(SyncResultSchema.parse(syncResult)).toEqual(expectedSyncResult);
    expect(syncResult.records.map((record) => ConnectorRecordSchema.parse(record))).toEqual(
      expectedSyncResult.records,
    );
  });

  it('maps rate-limit and refresh failures to the ConnectorError union', async () => {
    const rateLimitedConnector = createDescopeOutboundAppsConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_descope',
      observedAt,
      client: {
        listOutboundAppAssignments: () =>
          Promise.reject({ status: 429, retryAfterMs: 120_000, message: 'Too Many Requests' }),
      },
    });

    await expectMappedConnectorError(() => rateLimitedConnector.sync({ cursor: null }), {
      kind: 'rate_limit',
      retryAfterMs: 120_000,
    });

    const refreshFailedConnector = createDescopeOutboundAppsConnector({
      tenantId: 'tenant_acme',
      applicationId: 'app_descope',
      observedAt,
      client: {
        listOutboundAppAssignments: () =>
          Promise.reject({ code: 'refresh_token_expired', reason: 'refresh token expired' }),
      },
    });

    await expectMappedConnectorError(() => refreshFailedConnector.sync({ cursor: null }), {
      kind: 'refresh_failure',
      reason: 'refresh token expired',
    });
  });
});
