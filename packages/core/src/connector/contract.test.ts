import { describe, expect, it } from 'vitest';
import {
  CapabilityDescriptorSchema,
  ConnectorErrorSchema,
  ConnectorRecordSchema,
  type ConnectorRecord,
} from './contract.js';

const goldenAccessRows = [
  {
    tenantId: 'tenant_acme',
    applicationId: 'app_payroll',
    externalAccountId: 'acct_ada',
    recordType: 'access_grant',
    payload: {
      grantId: 'grant_payroll_admin',
      principalId: 'acct_ada',
      accessType: 'role',
      accessId: 'role_admin',
      source: 'golden-csv',
    },
    observedAt: '2026-06-08T12:00:00.000Z',
  },
] satisfies readonly ConnectorRecord[];

describe('connector contracts', () => {
  it('T2-S1 validates golden connector records', () => {
    expect(() => ConnectorRecordSchema.parse(goldenAccessRows[0])).not.toThrow();
  });

  it('T2-S2 accepts partial capabilities and known connector errors', () => {
    expect(() =>
      CapabilityDescriptorSchema.parse({
        contractVersion: '1.0.0',
        connectorId: 'payroll-csv',
        capabilities: {
          users: true,
          groups: false,
          access_grants: true,
          evidence_links: true,
        },
      }),
    ).not.toThrow();

    expect(() =>
      ConnectorErrorSchema.parse({ kind: 'rate_limit', retryAfterMs: 1000 }),
    ).not.toThrow();
    expect(() =>
      ConnectorErrorSchema.parse({ kind: 'refresh_failure', reason: 'refresh token expired' }),
    ).not.toThrow();
    expect(() =>
      ConnectorErrorSchema.parse({ kind: 'unknown', message: 'opaque connector failure' }),
    ).not.toThrow();
    expect(() => ConnectorErrorSchema.parse({ kind: 'timeout', message: 'not modeled' })).toThrow();
  });
});
