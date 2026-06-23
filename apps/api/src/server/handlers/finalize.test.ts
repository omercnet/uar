import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { getDatabaseUrl } from '../../db/client.js';
import { canConnect, resetUarDatabase } from '../../db/test-support.js';
import { withTenantTransaction } from '../../db/tenant-context.js';
import { exportCampaignCsvHandler, finalizeCampaignHandler } from './finalize.js';
import {
  closeServer,
  createHandlerServer,
  fixture,
  prepareMigratedDatabase,
  readCampaignStatus,
  seedReviewGraph,
} from './finalize.test-support.js';

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);
const runDbTest = databaseReachable ? it.sequential : it.skip;

const FinalizeResponseSchema = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  created: z.boolean(),
});

describe.sequential('finalize and CSV export handlers', () => {
  runDbTest('returns 404 when finalizing a missing campaign', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();
    const server = await createHandlerServer(finalizeCampaignHandler, db, fixture.campaignId);

    try {
      // When
      const response = await fetch(`${server.baseUrl}/campaigns/${fixture.campaignId}/finalize`, { method: 'POST' });

      // Then
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'not_found',
        message: `Campaign ${fixture.campaignId} not found`,
      });
    } finally {
      await closeServer(server.server);
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });

  runDbTest('rejects CSV export before campaign finalization', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();
    const server = await createHandlerServer(exportCampaignCsvHandler, db, fixture.campaignId);

    try {
      await withTenantTransaction(db, fixture.tenantId, (tx) => seedReviewGraph(tx, 'active'));

      // When
      const response = await fetch(`${server.baseUrl}/campaigns/${fixture.campaignId}/export.csv`);

      // Then
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'campaign_not_finalized',
        message: `Campaign ${fixture.campaignId} has not been finalized`,
      });
    } finally {
      await closeServer(server.server);
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });

  runDbTest('finalizes idempotently and exports CSV evidence', async () => {
    // Given
    const { client, db } = await prepareMigratedDatabase();
    const finalizeServer = await createHandlerServer(finalizeCampaignHandler, db, fixture.campaignId);
    const exportServer = await createHandlerServer(exportCampaignCsvHandler, db, fixture.campaignId);

    try {
      await withTenantTransaction(db, fixture.tenantId, (tx) => seedReviewGraph(tx, 'active'));

      // When
      const first = await fetch(`${finalizeServer.baseUrl}/campaigns/${fixture.campaignId}/finalize`, { method: 'POST' });
      const firstBody = FinalizeResponseSchema.parse(await first.json());
      const completedStatus = await readCampaignStatus(db);
      const second = await fetch(`${finalizeServer.baseUrl}/campaigns/${fixture.campaignId}/finalize`, { method: 'POST' });
      const secondBody = FinalizeResponseSchema.parse(await second.json());
      const csvResponse = await fetch(`${exportServer.baseUrl}/campaigns/${fixture.campaignId}/export.csv`);
      const csv = await csvResponse.text();

      // Then
      expect(first.status).toBe(200);
      expect(firstBody.created).toBe(true);
      expect(completedStatus).toBe('completed');
      expect(second.status).toBe(200);
      expect(secondBody).toEqual({ contentHash: firstBody.contentHash, created: false });
      expect(csvResponse.status).toBe(200);
      expect(csvResponse.headers.get('content-type')).toBe('text/csv');
      expect(csvResponse.headers.get('content-disposition')).toBe(
        `attachment; filename="evidence-${fixture.campaignId}.csv"`,
      );
      expect(csv).toContain('section,recordJson');
      expect(csv).toContain(fixture.grantA);
      expect(csv).toContain(fixture.grantB);
      expect(csv).toContain('approve');
      expect(csv).toContain('revoke');
    } finally {
      await closeServer(finalizeServer.server);
      await closeServer(exportServer.server);
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});
