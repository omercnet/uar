/**
 * In-memory, single-tenant API harness for the UAR Playwright e2e.
 *
 * WHY THIS EXISTS
 * ---------------
 * The web UI (apps/web) talks to an HTTP API at NEXT_PUBLIC_API_URL
 * (default http://localhost:3001) via apps/web/src/lib/api.ts. The repo ships
 * the API as a *library* (apps/api exports pure domain functions) but no HTTP
 * server binds those functions to the REST contract the UI expects. This
 * harness is that binding — strictly for e2e. It is single-tenant and stores
 * state in process memory, but it drives the REAL domain logic:
 *
 *   - @uar/connectors  createCsvConnector  (parse + page the access CSV)
 *   - @uar/api         materializeConnectorRecords (records -> snapshot nodes/edges)
 *   - @uar/core        review lifecycle (campaign/item transitions, decisions)
 *   - @uar/reporting   finalizeReviewExport (canonical SHA-256 content hash)
 *                      renderCsvEvidence    (deterministic CSV evidence export)
 *
 * Determinism: IDs and the timestamps that feed the content hash
 * (observedAt / decidedAt / assignedAt) are fixed constants, so finalize
 * produces a byte-for-byte reproducible content hash across runs, and
 * re-finalize is idempotent (same artifact, same hash).
 *
 * Run it with tsx (ESM):  pnpm exec tsx e2e/harness/server.ts
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { createCsvConnector } from '@uar/connectors';
import {
  ReviewAssignmentSchema,
  ReviewCampaignSchema,
  ReviewDecisionSchema,
  ReviewItemSchema,
  applyReviewDecision,
  assertReviewCampaignSnapshotFrozen,
  assertReviewCampaignTransition,
  assertReviewItemTransition,
  suggestReviewers,
  type ConnectorRecord,
  type ReviewAssignment,
  type ReviewCampaign,
  type ReviewCampaignStatus,
  type ReviewDecision,
  type ReviewItem,
} from '@uar/core';
import {
  materializeConnectorRecords,
  type SnapshotEdgeWrite,
  type SnapshotNodeWrite,
} from '@uar/api';
import {
  InMemoryFinalizationArtifactStore,
  ReviewContentEdgeSchema,
  ReviewContentNodeSchema,
  finalizeReviewExport,
  renderCsvEvidence,
} from '@uar/reporting';
import { z } from 'zod';

// ─── Single-tenant constants + deterministic timestamps ───────────────────────

const TENANT_ID = 'tenant-e2e';
const REVIEWER_USER_ID = 'reviewer-e2e';
const APPLICATION_ID = 'app-e2e-okta';
const FIXED_OBSERVED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_ASSIGNED_AT = '2026-01-10T00:00:00.000Z';
const FIXED_DECIDED_AT = '2026-01-15T00:00:00.000Z';

const PORT = Number(process.env.UAR_E2E_API_PORT ?? '3001');
const CSV_PATH = process.env.UAR_E2E_CSV ?? resolve(process.cwd(), 'e2e/fixtures/access.csv');

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

// ─── In-memory state ──────────────────────────────────────────────────────────

interface CampaignState {
  campaign: ReviewCampaign;
  items: ReviewItem[];
  decisions: ReviewDecision[];
  assignments: ReviewAssignment[];
  nodes: readonly SnapshotNodeWrite[];
  edges: readonly SnapshotEdgeWrite[];
}

const campaigns = new Map<string, CampaignState>();
const finalizeStore = new InMemoryFinalizationArtifactStore();
const finalizedCanonical = new Map<string, string>();
const finalizedHash = new Map<string, string>();

// ─── Request body schemas ─────────────────────────────────────────────────────

const CreateCampaignBody = z.object({
  name: z.string().min(1),
  snapshotId: z.string().min(1),
  startsAt: z.string().min(1),
  dueAt: z.string().min(1),
});

const UpdateStatusBody = z.object({
  status: z.enum(['draft', 'active', 'completed', 'cancelled']),
});

const DecideBody = z.object({
  decision: z.enum(['approve', 'revoke', 'exception', 'needs_follow_up']),
  note: z.string(),
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonBody<T>(raw: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(raw === '' ? '{}' : raw);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, `Invalid request body: ${parsed.error.message}`);
  }
  return parsed.data;
}

function requireCampaign(campaignId: string): CampaignState {
  const state = campaigns.get(campaignId);
  if (state === undefined) {
    throw new HttpError(404, `Campaign ${campaignId} not found`);
  }
  return state;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function createCampaign(raw: string): ReviewCampaign {
  const body = parseJsonBody(raw, CreateCampaignBody);
  const campaignId = `campaign-${body.snapshotId}`;
  const campaign = ReviewCampaignSchema.parse({
    tenantId: TENANT_ID,
    campaignId,
    name: body.name,
    snapshotId: body.snapshotId,
    snapshotLifecycle: assertReviewCampaignSnapshotFrozen('frozen'),
    status: 'draft',
    startsAt: new Date(body.startsAt).toISOString(),
    dueAt: new Date(body.dueAt).toISOString(),
    createdAt: new Date().toISOString(),
  });
  campaigns.set(campaignId, {
    campaign,
    items: [],
    decisions: [],
    assignments: [],
    nodes: [],
    edges: [],
  });
  return campaign;
}

function updateStatus(campaignId: string, raw: string): ReviewCampaign {
  const state = requireCampaign(campaignId);
  const body = parseJsonBody(raw, UpdateStatusBody);
  assertReviewCampaignTransition(state.campaign.status, body.status);
  state.campaign = { ...state.campaign, status: body.status };
  return state.campaign;
}

async function ingest(campaignId: string): Promise<{ itemCount: number }> {
  const state = requireCampaign(campaignId);

  // Idempotent: a second ingest does not duplicate items.
  if (state.items.length > 0) {
    return { itemCount: state.items.length };
  }

  const csvContent = readFileSync(CSV_PATH, 'utf8');
  const connector = createCsvConnector({
    tenantId: TENANT_ID,
    applicationId: APPLICATION_ID,
    csvContent,
    observedAt: FIXED_OBSERVED_AT,
  });

  const records: ConnectorRecord[] = [];
  for await (const page of connector.sync({ cursor: null })) {
    records.push(...page.records);
  }

  const materialized = materializeConnectorRecords({
    tenantId: TENANT_ID,
    snapshotId: state.campaign.snapshotId,
    records,
  });

  const items: ReviewItem[] = [];
  const assignments: ReviewAssignment[] = [];

  for (const record of records) {
    if (record.recordType !== 'access_grant') {
      continue;
    }
    const grantId =
      readPayloadString(record.payload, 'grantId') ??
      `${record.applicationId}:${record.externalAccountId}`;
    const reviewItemId = `item-${state.campaign.snapshotId}-${grantId}`;

    const pendingItem = ReviewItemSchema.parse({
      tenantId: TENANT_ID,
      reviewItemId,
      campaignId: state.campaign.campaignId,
      snapshotId: state.campaign.snapshotId,
      accessGrantId: grantId,
      applicationId: record.applicationId,
      externalAccountId: record.externalAccountId,
      status: 'pending',
      suggestedReviewerUserIds: suggestReviewers({}),
      createdAt: FIXED_OBSERVED_AT,
    });

    // Assign every generated item to the single e2e reviewer.
    assertReviewItemTransition(pendingItem.status, 'assigned');
    items.push(ReviewItemSchema.parse({ ...pendingItem, status: 'assigned' }));
    assignments.push(
      ReviewAssignmentSchema.parse({
        tenantId: TENANT_ID,
        assignmentId: `assign-${reviewItemId}`,
        campaignId: state.campaign.campaignId,
        reviewItemId,
        reviewerUserId: REVIEWER_USER_ID,
        status: 'assigned',
        assignedAt: FIXED_ASSIGNED_AT,
      }),
    );
  }

  state.items = items;
  state.assignments = assignments;
  state.nodes = materialized.nodes;
  state.edges = materialized.edges;

  return { itemCount: items.length };
}

function decide(campaignId: string, itemId: string, raw: string): ReviewDecision {
  const state = requireCampaign(campaignId);
  const item = state.items.find((candidate) => candidate.reviewItemId === itemId);
  if (item === undefined) {
    throw new HttpError(404, `Review item ${itemId} not found`);
  }
  const body = parseJsonBody(raw, DecideBody);
  const decisionId = `decision-${item.reviewItemId}`;

  const decision = ReviewDecisionSchema.parse({
    tenantId: TENANT_ID,
    decisionId,
    campaignId: state.campaign.campaignId,
    reviewItemId: item.reviewItemId,
    reviewerUserId: REVIEWER_USER_ID,
    decision: body.decision,
    decidedAt: FIXED_DECIDED_AT,
    note: body.note,
  });

  const updatedItem = applyReviewDecision(item, decision);
  state.items = state.items.map((candidate) =>
    candidate.reviewItemId === item.reviewItemId ? updatedItem : candidate,
  );
  state.decisions = [
    ...state.decisions.filter((existing) => existing.decisionId !== decisionId),
    decision,
  ];
  return decision;
}

function finalize(campaignId: string): { contentHash: string; created: boolean } {
  const state = requireCampaign(campaignId);

  const result = finalizeReviewExport(
    {
      nodes: state.nodes.map((node) => ReviewContentNodeSchema.parse(node)),
      edges: state.edges.map((edge) => ReviewContentEdgeSchema.parse(edge)),
      decisions: state.decisions,
      assignments: state.assignments,
      tenantId: TENANT_ID,
      campaignId: state.campaign.campaignId,
      snapshotId: state.campaign.snapshotId,
      finalizedAt: new Date().toISOString(),
    },
    finalizeStore,
  );

  finalizedCanonical.set(campaignId, result.canonicalContent);
  finalizedHash.set(campaignId, result.contentHash);

  if (state.campaign.status !== 'completed') {
    assertReviewCampaignTransition(state.campaign.status, 'completed');
    state.campaign = { ...state.campaign, status: 'completed' };
  }

  return { contentHash: result.contentHash, created: result.created };
}

function listReviewerCampaigns(): readonly ReviewCampaign[] {
  return [...campaigns.values()]
    .filter((state) => state.assignments.length > 0)
    .map((state) => state.campaign);
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (method === 'GET' && segments[0] === 'health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // /campaigns ...
  if (segments[0] === 'campaigns') {
    const campaignId = segments[1];

    if (method === 'GET' && campaignId === undefined) {
      sendJson(res, 200, [...campaigns.values()].map((state) => state.campaign));
      return;
    }
    if (method === 'POST' && campaignId === undefined) {
      sendJson(res, 201, createCampaign(await readBody(req)));
      return;
    }
    if (campaignId !== undefined) {
      const sub = segments[2];

      if (method === 'GET' && sub === undefined) {
        sendJson(res, 200, requireCampaign(campaignId).campaign);
        return;
      }
      if (method === 'PATCH' && sub === 'status') {
        sendJson(res, 200, updateStatus(campaignId, await readBody(req)));
        return;
      }
      if (method === 'POST' && sub === 'ingest') {
        sendJson(res, 200, await ingest(campaignId));
        return;
      }
      if (method === 'POST' && sub === 'finalize') {
        sendJson(res, 200, finalize(campaignId));
        return;
      }
      if (method === 'GET' && sub === 'export.csv') {
        const canonical = finalizedCanonical.get(campaignId);
        if (canonical === undefined) {
          throw new HttpError(409, `Campaign ${campaignId} has not been finalized`);
        }
        res.writeHead(200, {
          ...CORS_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="review-${campaignId}.csv"`,
        });
        res.end(renderCsvEvidence(canonical));
        return;
      }
      if (method === 'GET' && sub === 'items') {
        const itemId = segments[3];
        const state = requireCampaign(campaignId);
        if (itemId === undefined) {
          sendJson(res, 200, state.items);
          return;
        }
        const item = state.items.find((candidate) => candidate.reviewItemId === itemId);
        if (item === undefined) {
          throw new HttpError(404, `Review item ${itemId} not found`);
        }
        sendJson(res, 200, item);
        return;
      }
    }
  }

  // /review ...
  if (segments[0] === 'review' && segments[1] === 'campaigns') {
    const campaignId = segments[2];

    if (method === 'GET' && campaignId === undefined) {
      sendJson(res, 200, listReviewerCampaigns());
      return;
    }
    if (campaignId !== undefined && segments[3] === 'items') {
      const itemId = segments[4];
      const state = requireCampaign(campaignId);

      if (method === 'GET' && itemId === undefined) {
        sendJson(res, 200, state.items);
        return;
      }
      if (method === 'POST' && itemId !== undefined && segments[5] === 'decide') {
        sendJson(res, 200, decide(campaignId, itemId, await readBody(req)));
        return;
      }
    }
  }

  throw new HttpError(404, `No route for ${method} ${url.pathname}`);
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    sendJson(res, 500, { error: message });
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[uar-e2e-harness] listening on http://localhost:${PORT} (csv: ${CSV_PATH})`);
});
