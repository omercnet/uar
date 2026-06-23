import { randomUUID } from 'node:crypto';
import { createServer, type RequestListener, type Server } from 'node:http';

import { ReviewCampaignSchema } from '@uar/core';
import { describe, expect, it } from 'vitest';

import type { DescopeSessionVerifier } from '../auth/descope.js';
import { loadAuthzFlags } from '../config/flags.js';
import { createDatabaseClient } from '../db/client.js';
import { tenants } from '../db/schema/index.js';
import { resetUarDatabase } from '../db/test-support.js';
import { withTenantTransaction } from '../db/tenant-context.js';
import { createApp } from './app.js';
import { databaseReachable, databaseUrl, prepareMigratedDatabase } from './handlers/test-support.js';

type TestServer = {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
};

describe('production app bootstrap', () => {
  it.skipIf(!databaseReachable)('injects stub tenant context and db into campaign handlers', async () => {
    // Given
    const tenantId = randomUUID();
    const { client, db } = await prepareMigratedDatabase();
    const flags = loadAuthzFlags({
      STUB_AUTHZ: 'true',
      NODE_ENV: 'test',
      UAR_STUB_TENANT_ID: tenantId,
      UAR_STUB_USER_ID: randomUUID(),
      UAR_STUB_ROLES: 'admin',
    });
    const server = await startAppServer(createApp({ flags, db }));

    try {
      await withTenantTransaction(db, tenantId, (tx) =>
        tx.insert(tenants).values({ tenantId, slug: 'app-bootstrap', name: 'App Bootstrap' }),
      );

      // When
      const emptyListResponse = await fetch(`${server.baseUrl}/campaigns`);
      const createdResponse = await fetch(`${server.baseUrl}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Production Bootstrap Review',
          snapshotId: 'bootstrap-snapshot',
          startsAt: '2026-02-01T00:00:00.000Z',
          dueAt: '2026-02-28T00:00:00.000Z',
        }),
      });
      const created = ReviewCampaignSchema.parse(await createdResponse.json());
      const listResponse = await fetch(`${server.baseUrl}/campaigns`);
      const getResponse = await fetch(`${server.baseUrl}/campaigns/${created.campaignId}`);

      // Then
      expect(emptyListResponse.status).toBe(200);
      expect(await emptyListResponse.json()).toEqual([]);
      expect(createdResponse.status).toBe(201);
      expect(ReviewCampaignSchema.array().parse(await listResponse.json())).toContainEqual(created);
      expect(ReviewCampaignSchema.parse(await getResponse.json())).toEqual(created);
    } finally {
      await server.close();
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });

  it('returns ok status for health without authz or db access', async () => {
    // Given
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1, connect_timeout: 1 });
    const flags = loadAuthzFlags({ STUB_AUTHZ: 'true', NODE_ENV: 'test' });
    const server = await startAppServer(createApp({ flags, db }));

    try {
      // When
      const response = await fetch(`${server.baseUrl}/health`);

      // Then
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    } finally {
      await server.close();
      await client.end({ timeout: 1 });
    }
  });

  it('returns 401 before handler execution when authz denies the request', async () => {
    // Given
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1, connect_timeout: 1 });
    const flags = loadAuthzFlags({ STUB_AUTHZ: 'false', NODE_ENV: 'test' });
    const verifier = neverCalledVerifier();
    const server = await startAppServer(createApp({ verifier, flags, db }));

    try {
      // When
      const response = await fetch(`${server.baseUrl}/campaigns`);

      // Then
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated', message: 'Authentication required' });
    } finally {
      await server.close();
      await client.end({ timeout: 1 });
    }
  });

  it('rejects stub authz in production flags', () => {
    // When / Then
    expect(() => loadAuthzFlags({ STUB_AUTHZ: 'true', NODE_ENV: 'production' })).toThrow(
      'STUB_AUTHZ is not allowed in production',
    );
  });
});

async function startAppServer(listener: RequestListener): Promise<TestServer> {
  const server = createServer(listener);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return { baseUrl: serverBaseUrl(server), close: () => closeServer(server) };
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP listener');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function neverCalledVerifier(): DescopeSessionVerifier {
  return {
    verifySessionToken: () => Promise.reject(new Error('Verifier should not run without a bearer token')),
  };
}
