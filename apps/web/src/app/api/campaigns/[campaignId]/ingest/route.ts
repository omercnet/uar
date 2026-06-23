import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type NextRequest, NextResponse } from 'next/server';

import {
  countItems,
  createDrizzleIngestJobStore,
  getCampaign,
  insertItemsAndAssignments,
  runCsvIngestJob,
  upsertDirectoryGraph,
  withTenantTransaction,
} from '@uar/api';
import { createCsvConnector } from '@uar/connectors';
import type { ConnectorRecord, ReviewCampaign, SyncResult } from '@uar/core';
import { z } from 'zod';
import { assignReviewItem, generateReviewItems } from '@uar/api';
import type { ReviewCampaignRecord } from '@uar/api';

import { authenticate, conflict, notFound, requireUuid } from '@/lib/route-auth';

const DEFAULT_APPLICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AccessGrantPayloadKeySchema = z.object({ grantId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;
  const { campaignId } = await params;

  const id = requireUuid(campaignId, 'campaignId');
  if (id instanceof NextResponse) return id;

  const csvPath = process.env.UAR_INGEST_CSV ?? resolve(process.cwd(), '../../e2e/fixtures/access.csv');
  const csvContent = await readFile(csvPath, 'utf8');
  const applicationId = process.env.UAR_INGEST_APPLICATION_ID ?? DEFAULT_APPLICATION_ID;

  const itemCount = await withTenantTransaction(db, tenantContext.tenantId, async (tx) => {
    const campaign = await getCampaign(tx, tenantContext.tenantId, id);
    if (campaign === undefined) return null;

    if (campaign.status === 'completed') return 'completed' as const;

    const existing = await countItems(tx, tenantContext.tenantId, id);
    if (existing > 0) return existing;

    await runCsvIngestJob(
      { jobId: randomUUID(), tenantContext, payload: { connectorId: 'manual-csv', applicationId, csvContent, schemaVersion: '1' } },
      { store: createDrizzleIngestJobStore({ tx, tenantId: tenantContext.tenantId, existingSnapshotId: campaign.snapshotId }) },
    );

    const connector = createCsvConnector({ tenantId: tenantContext.tenantId, applicationId, csvContent });
    const records = await collectAccessGrantRecords(connector.sync({ cursor: null }));
    const maps = await upsertDirectoryGraph(tx, tenantContext.tenantId, records);

    const now = new Date().toISOString();
    const items = generateReviewItems({
      campaign: toCampaignRecord(campaign),
      snapshotId: campaign.snapshotId,
      accessGrants: records.map((record) => {
        const { grantId } = AccessGrantPayloadKeySchema.parse(record.payload);
        const ids = maps.accessGrants[grantId];
        if (ids === undefined) throw new Error(`Missing directory entry for grant ${grantId}`);
        return { accessGrantId: ids.accessGrantId, applicationId: ids.applicationId, externalAccountId: ids.externalAccountId, accessGrantOwnerUserId: ids.userIdentityId };
      }),
      createdAt: now,
      createReviewItemId: () => randomUUID(),
    }).map((item) => assignReviewItem({ item, assignmentId: item.reviewItemId, reviewerUserId: tenantContext.userId, assignedAt: now }).item);

    await insertItemsAndAssignments(tx, tenantContext.tenantId, {
      campaignId: id,
      snapshotId: campaign.snapshotId,
      reviewerUserId: tenantContext.userId,
      items,
    });

    return items.length;
  });

  if (itemCount === null) return notFound('not_found', `Campaign ${id} not found`);
  if (itemCount === 'completed') return conflict('campaign_completed', 'Cannot ingest into a finalized campaign');
  return NextResponse.json({ itemCount });
}

async function collectAccessGrantRecords(pages: AsyncIterable<SyncResult>): Promise<readonly ConnectorRecord[]> {
  const records: ConnectorRecord[] = [];
  for await (const page of pages) {
    for (const record of page.records) {
      if (record.recordType === 'access_grant') records.push(record);
    }
  }
  return records;
}

function toCampaignRecord(c: ReviewCampaign): ReviewCampaignRecord {
  return { tenantId: c.tenantId, campaignId: c.campaignId, name: c.name, snapshotId: c.snapshotId, snapshotLifecycle: c.snapshotLifecycle, status: 'draft', startsAt: c.startsAt, dueAt: c.dueAt, createdAt: c.createdAt };
}
