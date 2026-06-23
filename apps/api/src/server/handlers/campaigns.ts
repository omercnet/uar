import {
  ReviewCampaignStatusSchema,
  ReviewLifecycleTransitionError,
  type ReviewCampaignStatus,
} from '@uar/core';
import { z } from 'zod';

import {
  createCampaignWithSnapshot,
  getCampaign,
  listCampaigns,
  updateCampaignStatus,
} from '../../review/campaign-repo.js';
import { getCampaignItem, listCampaignItems } from '../../review/items-repo.js';
import { withTenantTransaction } from '../../db/tenant-context.js';
import { readJsonBody, sendJson } from '../http-adapter.js';
import { HttpError, type HandlerContext, type RouteHandler } from '../router.js';

const RouteUuidSchema = z.uuid();

const CreateCampaignBodySchema = z.object({
  name: z.string().min(1),
  snapshotId: z.string().min(1),
  startsAt: z.iso.datetime().transform((value) => new Date(value)),
  dueAt: z.iso.datetime().transform((value) => new Date(value)),
});

const UpdateCampaignStatusBodySchema = z.object({
  status: ReviewCampaignStatusSchema,
});

export const listCampaignsHandler: RouteHandler = async (ctx) => {
  const campaigns = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, (tx) =>
    listCampaigns(tx, ctx.tenantContext.tenantId),
  );

  sendJson(ctx.res, 200, campaigns);
};

export const createCampaignHandler: RouteHandler = async (ctx) => {
  const body = parseCreateCampaignBody(await readJsonBody(ctx.req));
  const campaign = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, (tx) =>
    createCampaignWithSnapshot(tx, ctx.tenantContext.tenantId, body),
  );

  sendJson(ctx.res, 201, campaign);
};

export const getCampaignHandler: RouteHandler = async (ctx) => {
  const campaignId = requireUuidParam(ctx.params, 'campaignId');
  const campaign = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, (tx) =>
    getCampaign(tx, ctx.tenantContext.tenantId, campaignId),
  );

  sendJson(ctx.res, 200, requireFound(campaign, 'campaign_not_found', `Campaign ${campaignId} not found`));
};

export const updateCampaignStatusHandler: RouteHandler = async (ctx) => {
  const campaignId = requireUuidParam(ctx.params, 'campaignId');
  const { status } = parseUpdateCampaignStatusBody(await readJsonBody(ctx.req));

  try {
    const campaign = await updateCampaignStatusInTransaction(ctx, campaignId, status);
    sendJson(ctx.res, 200, requireFound(campaign, 'campaign_not_found', `Campaign ${campaignId} not found`));
  } catch (error) {
    if (error instanceof ReviewLifecycleTransitionError) {
      throw new HttpError(409, { error: 'invalid_transition', message: error.message });
    }
    throw error;
  }
};

export const listCampaignItemsHandler: RouteHandler = async (ctx) => {
  const campaignId = requireUuidParam(ctx.params, 'campaignId');
  const items = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, (tx) =>
    listCampaignItems(tx, ctx.tenantContext.tenantId, campaignId),
  );

  sendJson(ctx.res, 200, items);
};

export const getCampaignItemHandler: RouteHandler = async (ctx) => {
  const campaignId = requireUuidParam(ctx.params, 'campaignId');
  const itemId = requireUuidParam(ctx.params, 'itemId');
  const item = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, (tx) =>
    getCampaignItem(tx, ctx.tenantContext.tenantId, campaignId, itemId),
  );

  sendJson(ctx.res, 200, requireFound(item, 'review_item_not_found', `Review item ${itemId} not found`));
};

function parseCreateCampaignBody(body: unknown): z.infer<typeof CreateCampaignBodySchema> {
  const parsed = CreateCampaignBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, { error: 'bad_request', message: 'Invalid request body' });
  }
  return parsed.data;
}

function parseUpdateCampaignStatusBody(body: unknown): { readonly status: ReviewCampaignStatus } {
  const parsed = UpdateCampaignStatusBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, { error: 'bad_request', message: 'Invalid request body' });
  }
  return parsed.data;
}

function requireParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = params[name];
  if (value === undefined || value.length === 0) {
    throw new HttpError(404, { error: 'not_found', message: `Missing route parameter ${name}` });
  }
  return value;
}

function requireUuidParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = requireParam(params, name);
  const parsed = RouteUuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(404, { error: 'not_found', message: `Route parameter ${name} was not found` });
  }
  return parsed.data;
}

function requireFound<Value>(value: Value | undefined, error: string, message: string): Value {
  if (value === undefined) {
    throw new HttpError(404, { error, message });
  }
  return value;
}

async function updateCampaignStatusInTransaction(
  ctx: HandlerContext,
  campaignId: string,
  status: ReviewCampaignStatus,
): Promise<Awaited<ReturnType<typeof updateCampaignStatus>>> {
  return withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, (tx) =>
    updateCampaignStatus(tx, ctx.tenantContext.tenantId, campaignId, status),
  );
}
