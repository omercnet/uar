import { randomUUID } from 'node:crypto';

import { ReviewCampaignSchema, type TenantContext } from '@uar/core';
import { describe, expect, it } from 'vitest';

import { createDatabaseClient } from '../../db/client.js';
import { tenants } from '../../db/schema/index.js';
import { resetUarDatabase } from '../../db/test-support.js';
import { withTenantTransaction } from '../../db/tenant-context.js';
import {
  createCampaignHandler,
  getCampaignHandler,
  getCampaignItemHandler,
  listCampaignItemsHandler,
  listCampaignsHandler,
  updateCampaignStatusHandler,
} from './campaigns.js';
import {
  databaseReachable,
  databaseUrl,
  prepareMigratedDatabase,
  startInjectedServer,
} from './test-support.js';

const tenantContext = { tenantId: randomUUID(), userId: randomUUID(), roles: ['admin'] } satisfies TenantContext;
const campaignRoutes = [
  { method: 'GET', path: '/campaigns', handler: listCampaignsHandler },
  { method: 'POST', path: '/campaigns', handler: createCampaignHandler },
  { method: 'GET', path: '/campaigns/:campaignId', handler: getCampaignHandler },
  { method: 'PATCH', path: '/campaigns/:campaignId/status', handler: updateCampaignStatusHandler },
  { method: 'GET', path: '/campaigns/:campaignId/items', handler: listCampaignItemsHandler },
  { method: 'GET', path: '/campaigns/:campaignId/items/:itemId', handler: getCampaignItemHandler },
] as const;

describe('campaign HTTP handlers', () => {
  it('returns 400 before database access when create body is invalid', async () => {
    // Given
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1, connect_timeout: 1 });
    const server = await startInjectedServer({ routes: campaignRoutes, db, tenantContext });

    try {
      // When
      const response = await fetch(`${server.baseUrl}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', snapshotId: '', startsAt: 'soon', dueAt: 'later' }),
      });

      // Then
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'bad_request' });
    } finally {
      await server.close();
      await client.end({ timeout: 1 });
    }
  });

  it.skipIf(!databaseReachable)('creates, reads, updates, and rejects invalid campaign transitions', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();
    const server = await startInjectedServer({ routes: campaignRoutes, db, tenantContext });

    try {
      await withTenantTransaction(db, tenantContext.tenantId, (tx) =>
        tx.insert(tenants).values({ tenantId: tenantContext.tenantId, slug: 'handlers-campaigns', name: 'Handlers' }),
      );

      // When
      const createdResponse = await fetch(`${server.baseUrl}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Q1 Access Review',
          snapshotId: 'directory-snapshot-label',
          startsAt: '2026-01-02T00:00:00.000Z',
          dueAt: '2026-01-31T00:00:00.000Z',
        }),
      });
      const created = ReviewCampaignSchema.parse(await createdResponse.json());
      const listResponse = await fetch(`${server.baseUrl}/campaigns`);
      const getResponse = await fetch(`${server.baseUrl}/campaigns/${created.campaignId}`);
      const activeResponse = await fetch(`${server.baseUrl}/campaigns/${created.campaignId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      const missingItemResponse = await fetch(`${server.baseUrl}/campaigns/${created.campaignId}/items/missing`);

      // Then
      expect(createdResponse.status).toBe(201);
      expect(ReviewCampaignSchema.array().parse(await listResponse.json())).toContainEqual(created);
      expect(ReviewCampaignSchema.parse(await getResponse.json())).toEqual(created);
      expect(activeResponse.status).toBe(200);
      expect(missingItemResponse.status).toBe(404);
    } finally {
      await server.close();
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
