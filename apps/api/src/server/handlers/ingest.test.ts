import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { TenantContext } from '@uar/core';
import { and, count, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, getDatabaseUrl, type DatabaseClient } from '../../db/client.js';
import { migrateDatabase } from '../../db/migrate.js';
import { reviewAssignments, reviewItems, snapshots, tenants, userIdentities } from '../../db/schema/index.js';
import { canConnect, resetUarDatabase } from '../../db/test-support.js';
import { type TenantDb, withTenantTransaction } from '../../db/tenant-context.js';
import { createCampaignWithSnapshot } from '../../review/campaign-repo.js';
import { sendJson } from '../http-adapter.js';
import { HttpError, type HandlerContext, type RouteHandler } from '../router.js';
import { createIngestHandler, ingest, type IngestDependencies } from './ingest.js';

type UnitTx = { readonly marker: 'unit-tx' };

type RunningServer = {
  readonly baseUrl: string;
};

type JsonResponse = {
  readonly status: number;
  readonly body: unknown;
};

type SeededCampaign = {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly snapshotId: string;
  readonly reviewerUserId: string;
};

type CampaignState = {
  readonly snapshotLifecycle: string;
  readonly itemCount: number;
  readonly assignedItemCount: number;
  readonly assignmentCount: number;
  readonly reviewerAssignmentCount: number;
};

type ServerInput = {
  readonly handler: RouteHandler;
  readonly db: DatabaseClient;
  readonly tenantContext: TenantContext;
  readonly campaignId: string;
};

class UnexpectedDependencyCallError extends Error {
  override readonly name = 'UnexpectedDependencyCallError';

  constructor(readonly dependencyName: string) {
    super(`Unexpected unit test dependency call: ${dependencyName}`);
  }
}

class ExpectedRowMissingError extends Error {
  override readonly name = 'ExpectedRowMissingError';

  constructor(readonly detail: string) {
    super(`Expected row missing: ${detail}`);
  }
}

const databaseUrl = getDatabaseUrl();
const databaseReachable = await canConnect(databaseUrl);
const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

describe('POST /campaigns/:id/ingest handler', () => {
  it('returns 404 when campaign is missing without requiring Postgres', async () => {
    // Given
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1 });
    const handler = createIngestHandler(createMissingCampaignDependencies());
    const running = await startServer({
      handler,
      db,
      tenantContext: createTenantContext(randomUUID(), randomUUID()),
      campaignId: randomUUID(),
    });

    try {
      // When
      const response = await postJson(`${running.baseUrl}/campaigns/missing/ingest`);

      // Then
      expect(response).toEqual({
        status: 404,
        body: { error: 'not_found', message: 'Review campaign not found' },
      });
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it.skipIf(!databaseReachable)('ingests fixture once, freezes snapshot, and returns existing count on retry', async () => {
    // Given
    await resetUarDatabase(databaseUrl);
    await migrateDatabase({ databaseUrl });
    const { client, db } = createDatabaseClient(databaseUrl, { max: 1 });

    try {
      const tenantId = randomUUID();
      const seeded = await withTenantTransaction(db, tenantId, (tx) => seedCampaign(tx, tenantId));
      const tenantContext = createTenantContext(seeded.tenantId, seeded.reviewerUserId);
      const running = await startServer({ handler: ingest, db, tenantContext, campaignId: seeded.campaignId });

      // When
      const firstResponse = await postJson(`${running.baseUrl}/campaigns/${seeded.campaignId}/ingest`);
      const firstState = await withTenantTransaction(db, seeded.tenantId, (tx) => readCampaignState(tx, seeded));
      const secondResponse = await postJson(`${running.baseUrl}/campaigns/${seeded.campaignId}/ingest`);
      const secondState = await withTenantTransaction(db, seeded.tenantId, (tx) => readCampaignState(tx, seeded));

      // Then
      expect(firstResponse).toEqual({ status: 200, body: { itemCount: 4 } });
      expect(secondResponse).toEqual({ status: 200, body: { itemCount: 4 } });
      expect(firstState).toEqual({
        snapshotLifecycle: 'frozen',
        itemCount: 4,
        assignedItemCount: 4,
        assignmentCount: 4,
        reviewerAssignmentCount: 4,
      });
      expect(secondState).toEqual(firstState);
    } finally {
      await client.end({ timeout: 1 });
      await resetUarDatabase(databaseUrl);
    }
  });
});

function createMissingCampaignDependencies(): IngestDependencies<UnitTx> {
  const tx = { marker: 'unit-tx' } satisfies UnitTx;

  return {
    runInTransaction: async ({ run }) => run(tx),
    getCampaign: async () => undefined,
    countItems: async () => unexpectedDependency('countItems'),
    runCsvIngestJob: async () => unexpectedDependency('runCsvIngestJob'),
    createIngestJobStore: () => unexpectedDependency('createIngestJobStore'),
    createCsvConnector: () => unexpectedDependency('createCsvConnector'),
    upsertDirectoryGraph: async () => unexpectedDependency('upsertDirectoryGraph'),
    insertItemsAndAssignments: async () => unexpectedDependency('insertItemsAndAssignments'),
    createId: () => randomUUID(),
    now: () => new Date().toISOString(),
    readCsvContent: async () => unexpectedDependency('readCsvContent'),
  };
}

async function startServer(input: ServerInput): Promise<RunningServer> {
  const server = createServer((req, res) => {
    void handleRequest({ ...input, req, res });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new ExpectedRowMissingError('server address');
  }
  openServers.push(server);

  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function handleRequest(input: ServerInput & { readonly req: IncomingMessage; readonly res: ServerResponse }): Promise<void> {
  try {
    await input.handler(createHandlerContext(input));
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(input.res, error.status, error.body);
      return;
    }
    throw error;
  }
}

function createHandlerContext(input: ServerInput & { readonly req: IncomingMessage; readonly res: ServerResponse }): HandlerContext {
  return {
    tenantContext: input.tenantContext,
    db: input.db,
    req: input.req,
    res: input.res,
    params: { campaignId: input.campaignId },
    url: new URL(input.req.url ?? '/', 'http://localhost'),
  };
}

async function postJson(url: string): Promise<JsonResponse> {
  const response = await fetch(url, { method: 'POST' });

  return { status: response.status, body: await response.json() };
}

async function seedCampaign(tx: TenantDb, tenantId: string): Promise<SeededCampaign> {
  const reviewerUserId = randomUUID();
  await tx.insert(tenants).values({ tenantId, slug: `tenant-${tenantId}`, name: 'Ingest Handler Tenant' });
  await tx.insert(userIdentities).values({
    id: reviewerUserId,
    tenantId,
    primaryEmail: 'reviewer@example.test',
    displayName: 'Reviewer',
  });
  const campaign = await createCampaignWithSnapshot(tx, tenantId, {
    name: 'Quarterly access review',
    snapshotId: randomUUID(),
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    dueAt: new Date('2026-02-01T00:00:00.000Z'),
  });

  return { tenantId, campaignId: campaign.campaignId, snapshotId: campaign.snapshotId, reviewerUserId };
}

async function readCampaignState(tx: TenantDb, seeded: SeededCampaign): Promise<CampaignState> {
  const [snapshot] = await tx
    .select({ lifecycle: snapshots.lifecycle })
    .from(snapshots)
    .where(and(eq(snapshots.tenantId, seeded.tenantId), eq(snapshots.id, seeded.snapshotId)))
    .limit(1);
  const [itemCount] = await tx
    .select({ value: count() })
    .from(reviewItems)
    .where(and(eq(reviewItems.tenantId, seeded.tenantId), eq(reviewItems.campaignId, seeded.campaignId)));
  const [assignedItemCount] = await tx
    .select({ value: count() })
    .from(reviewItems)
    .where(
      and(
        eq(reviewItems.tenantId, seeded.tenantId),
        eq(reviewItems.campaignId, seeded.campaignId),
        eq(reviewItems.status, 'assigned'),
      ),
    );
  const [assignmentCount] = await tx
    .select({ value: count() })
    .from(reviewAssignments)
    .where(and(eq(reviewAssignments.tenantId, seeded.tenantId), eq(reviewAssignments.campaignId, seeded.campaignId)));
  const [reviewerAssignmentCount] = await tx
    .select({ value: count() })
    .from(reviewAssignments)
    .where(
      and(
        eq(reviewAssignments.tenantId, seeded.tenantId),
        eq(reviewAssignments.campaignId, seeded.campaignId),
        eq(reviewAssignments.reviewerUserId, seeded.reviewerUserId),
      ),
    );

  return {
    snapshotLifecycle: expectRow(snapshot, 'snapshot').lifecycle,
    itemCount: expectRow(itemCount, 'item count').value,
    assignedItemCount: expectRow(assignedItemCount, 'assigned item count').value,
    assignmentCount: expectRow(assignmentCount, 'assignment count').value,
    reviewerAssignmentCount: expectRow(reviewerAssignmentCount, 'reviewer assignment count').value,
  };
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

function createTenantContext(tenantId: string, userId: string): TenantContext {
  return { tenantId, userId, roles: ['admin'] };
}

function expectRow<T>(row: T | undefined, detail: string): T {
  if (row === undefined) {
    throw new ExpectedRowMissingError(detail);
  }

  return row;
}

function unexpectedDependency(dependencyName: string): never {
  throw new UnexpectedDependencyCallError(dependencyName);
}
