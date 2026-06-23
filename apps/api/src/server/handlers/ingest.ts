import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createCsvConnector } from '@uar/connectors';
import type { ConnectorRecord, ReviewCampaign, SyncResult } from '@uar/core';
import { z } from 'zod';

import { type TenantDb, withTenantTransaction } from '../../db/tenant-context.js';
import { type IngestJobStore, runCsvIngestJob } from '../../ingest/job.js';
import { assignReviewItem } from '../../review/assignments.js';
import type { ReviewCampaignRecord } from '../../review/campaign.js';
import { getCampaign } from '../../review/campaign-repo.js';
import { type DirectoryGraphReferenceMaps, upsertDirectoryGraph } from '../../review/directory-repo.js';
import { generateReviewItems, type ReviewItemAccessGrantInput, type ReviewItemRecord } from '../../review/items.js';
import {
  countItems,
  insertItemsAndAssignments,
  type InsertItemsAndAssignmentsInput,
} from '../../review/items-repo.js';
import { createDrizzleIngestJobStore } from '../../snapshot/ingest-store.js';
import { sendJson } from '../http-adapter.js';
import { HttpError, type HandlerContext, type RouteHandler } from '../router.js';

const DEFAULT_APPLICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AccessGrantPayloadKeySchema = z.object({ grantId: z.string().min(1) });

type TransactionInput<Tx, Result> = {
  readonly ctx: HandlerContext;
  readonly tenantId: string;
  readonly run: (tx: Tx) => Promise<Result>;
};

export type IngestDependencies<Tx> = {
  readonly runInTransaction: <Result>(input: TransactionInput<Tx, Result>) => Promise<Result>;
  readonly getCampaign: (tx: Tx, tenantId: string, campaignId: string) => ReturnType<typeof getCampaign>;
  readonly countItems: (tx: Tx, tenantId: string, campaignId: string) => ReturnType<typeof countItems>;
  readonly runCsvIngestJob: typeof runCsvIngestJob;
  readonly createIngestJobStore: (input: {
    readonly tx: Tx;
    readonly tenantId: string;
    readonly existingSnapshotId: string;
  }) => IngestJobStore;
  readonly createCsvConnector: typeof createCsvConnector;
  readonly upsertDirectoryGraph: (
    tx: Tx,
    tenantId: string,
    records: readonly ConnectorRecord[],
  ) => ReturnType<typeof upsertDirectoryGraph>;
  readonly insertItemsAndAssignments: (
    tx: Tx,
    tenantId: string,
    input: InsertItemsAndAssignmentsInput,
  ) => ReturnType<typeof insertItemsAndAssignments>;
  readonly createId: () => string;
  readonly now: () => string;
  readonly readCsvContent: () => Promise<string>;
};

type IngestCampaignInput<Tx> = {
  readonly tx: Tx;
  readonly ctx: HandlerContext;
  readonly tenantId: string;
  readonly campaignId: string;
  readonly dependencies: IngestDependencies<Tx>;
};

type BuildItemsInput = {
  readonly campaign: ReviewCampaign;
  readonly records: readonly ConnectorRecord[];
  readonly maps: DirectoryGraphReferenceMaps;
  readonly reviewerUserId: string;
  readonly createdAt: string;
  readonly createId: () => string;
};

class DirectoryAccessGrantMissingError extends Error {
  override readonly name = 'DirectoryAccessGrantMissingError';

  constructor(readonly grantId: string) {
    super(`Directory graph did not return an access grant for connector grant ${grantId}`);
  }
}

const defaultDependencies = {
  runInTransaction: async <Result>({ ctx, tenantId, run }: TransactionInput<TenantDb, Result>) =>
    withTenantTransaction(ctx.db, tenantId, run),
  getCampaign,
  countItems,
  runCsvIngestJob,
  createIngestJobStore: createDrizzleIngestJobStore,
  createCsvConnector,
  upsertDirectoryGraph,
  insertItemsAndAssignments,
  createId: () => randomUUID(),
  now: () => new Date().toISOString(),
  readCsvContent: readConfiguredCsvContent,
} satisfies IngestDependencies<TenantDb>;

export const ingest = createIngestHandler(defaultDependencies);

export function createIngestHandler<Tx>(dependencies: IngestDependencies<Tx>): RouteHandler {
  return async (ctx) => {
    const tenantId = ctx.tenantContext.tenantId;
    const campaignId = requireCampaignId(ctx.params);
    const itemCount = await dependencies.runInTransaction({
      ctx,
      tenantId,
      run: (tx) => ingestCampaign({ tx, ctx, tenantId, campaignId, dependencies }),
    });

    sendJson(ctx.res, 200, { itemCount });
  };
}

async function ingestCampaign<Tx>(input: IngestCampaignInput<Tx>): Promise<number> {
  const campaign = await input.dependencies.getCampaign(input.tx, input.tenantId, input.campaignId);
  if (campaign === undefined) {
    throw new HttpError(404, { error: 'not_found', message: 'Review campaign not found' });
  }

  const existingItemCount = await input.dependencies.countItems(input.tx, input.tenantId, input.campaignId);
  if (existingItemCount > 0) {
    return existingItemCount;
  }

  const csvContent = await input.dependencies.readCsvContent();
  const applicationId = process.env.UAR_INGEST_APPLICATION_ID ?? DEFAULT_APPLICATION_ID;
  await input.dependencies.runCsvIngestJob(
    {
      jobId: input.dependencies.createId(),
      tenantContext: input.ctx.tenantContext,
      payload: { connectorId: 'manual-csv', applicationId, csvContent, schemaVersion: '1' },
    },
    {
      store: input.dependencies.createIngestJobStore({
        tx: input.tx,
        tenantId: input.tenantId,
        existingSnapshotId: campaign.snapshotId,
      }),
    },
  );

  const connector = input.dependencies.createCsvConnector({ tenantId: input.tenantId, applicationId, csvContent });
  const records = await collectAccessGrantRecords(connector.sync({ cursor: null }));
  const maps = await input.dependencies.upsertDirectoryGraph(input.tx, input.tenantId, records);
  const items = buildAssignedReviewItems({
    campaign,
    records,
    maps,
    reviewerUserId: input.ctx.tenantContext.userId,
    createdAt: input.dependencies.now(),
    createId: input.dependencies.createId,
  });

  await input.dependencies.insertItemsAndAssignments(input.tx, input.tenantId, {
    campaignId: input.campaignId,
    snapshotId: campaign.snapshotId,
    reviewerUserId: input.ctx.tenantContext.userId,
    items,
  });

  return items.length;
}

async function collectAccessGrantRecords(pages: AsyncIterable<SyncResult>): Promise<readonly ConnectorRecord[]> {
  const records: ConnectorRecord[] = [];
  for await (const page of pages) {
    for (const record of page.records) {
      if (record.recordType === 'access_grant') {
        records.push(record);
      }
    }
  }

  return records;
}

function buildAssignedReviewItems(input: BuildItemsInput): readonly ReviewItemRecord[] {
  const items = generateReviewItems({
    campaign: toReviewCampaignRecord(input.campaign),
    snapshotId: input.campaign.snapshotId,
    accessGrants: buildAccessGrantInputs(input.records, input.maps),
    createdAt: input.createdAt,
    createReviewItemId: input.createId,
  });

  return items.map(
    (item) =>
      assignReviewItem({
        item,
        assignmentId: item.reviewItemId,
        reviewerUserId: input.reviewerUserId,
        assignedAt: input.createdAt,
      }).item,
  );
}

function buildAccessGrantInputs(
  records: readonly ConnectorRecord[],
  maps: DirectoryGraphReferenceMaps,
): readonly ReviewItemAccessGrantInput[] {
  return records.map((record) => {
    const payload = AccessGrantPayloadKeySchema.parse(record.payload);
    const ids = maps.accessGrants[payload.grantId];
    if (ids === undefined) {
      throw new DirectoryAccessGrantMissingError(payload.grantId);
    }

    return {
      accessGrantId: ids.accessGrantId,
      applicationId: ids.applicationId,
      externalAccountId: ids.externalAccountId,
      accessGrantOwnerUserId: ids.userIdentityId,
    };
  });
}

function toReviewCampaignRecord(campaign: ReviewCampaign): ReviewCampaignRecord {
  return {
    tenantId: campaign.tenantId,
    campaignId: campaign.campaignId,
    name: campaign.name,
    snapshotId: campaign.snapshotId,
    snapshotLifecycle: campaign.snapshotLifecycle,
    status: 'draft',
    startsAt: campaign.startsAt,
    dueAt: campaign.dueAt,
    createdAt: campaign.createdAt,
  };
}

function requireCampaignId(params: Readonly<Record<string, string>>): string {
  const campaignId = params['campaignId'];
  if (campaignId === undefined || campaignId.length === 0) {
    throw new HttpError(400, { error: 'bad_request', message: 'Missing campaignId route param' });
  }

  return campaignId;
}

async function readConfiguredCsvContent(): Promise<string> {
  const csvPath = process.env.UAR_INGEST_CSV ?? resolve(process.cwd(), '../../e2e/fixtures/access.csv');

  return readFile(csvPath, 'utf8');
}
