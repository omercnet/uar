import { randomUUID } from 'node:crypto';

import { ReviewDecisionActionSchema, ReviewDecisionSchema, ReviewLifecycleTransitionError } from '@uar/core';
import { z } from 'zod';

import { withTenantTransaction } from '../../db/tenant-context.js';
import { getCampaign } from '../../review/campaign-repo.js';
import { applyDecisionAndPersist } from '../../review/decisions-repo.js';
import { listCampaignsAssignedTo, listItemsAssignedTo } from '../../review/items-repo.js';
import { readJsonBody, sendJson } from '../http-adapter.js';
import { HttpError, type RouteHandler } from '../router.js';

const DecideBodySchema = z.object({
  decision: ReviewDecisionActionSchema,
  note: z.string(),
});
const RouteUuidSchema = z.uuid();

export const listReviewCampaignsHandler: RouteHandler = async (ctx) => {
  const campaigns = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, async (tx) => {
    const campaignIds = await listCampaignsAssignedTo(tx, ctx.tenantContext.tenantId, ctx.tenantContext.userId);
    const loaded = await Promise.all(campaignIds.map((campaignId) => getCampaign(tx, ctx.tenantContext.tenantId, campaignId)));

    return loaded.filter((campaign) => campaign !== undefined);
  });

  sendJson(ctx.res, 200, campaigns);
};

export const getReviewCampaignItemsHandler: RouteHandler = async (ctx) => {
  const campaignId = requireUuidParam(ctx.params, 'campaignId');
  const items = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, async (tx) => {
    const assigned = await listItemsAssignedTo(tx, ctx.tenantContext.tenantId, ctx.tenantContext.userId);
    return assigned.filter((item) => item.campaignId === campaignId);
  });

  sendJson(ctx.res, 200, items);
};

export const decideReviewItemHandler: RouteHandler = async (ctx) => {
  const campaignId = requireUuidParam(ctx.params, 'campaignId');
  const itemId = requireUuidParam(ctx.params, 'itemId');
  const body = parseDecideBody(await readJsonBody(ctx.req));

  try {
    const decision = await withTenantTransaction(ctx.db, ctx.tenantContext.tenantId, async (tx) => {
      const assigned = await listItemsAssignedTo(tx, ctx.tenantContext.tenantId, ctx.tenantContext.userId);
      const item = assigned.find((candidate) => candidate.campaignId === campaignId && candidate.reviewItemId === itemId);
      if (item === undefined) {
        throw new HttpError(404, { error: 'review_item_not_found', message: `Review item ${itemId} not found` });
      }

      const recorded = await applyDecisionAndPersist(tx, ctx.tenantContext.tenantId, {
        item,
        decision: {
          decisionId: randomUUID(),
          reviewerUserId: ctx.tenantContext.userId,
          decision: body.decision,
          decidedAt: new Date().toISOString(),
          note: body.note,
        },
      });

      return ReviewDecisionSchema.parse(recorded);
    });

    sendJson(ctx.res, 200, decision);
  } catch (error) {
    if (error instanceof ReviewLifecycleTransitionError) {
      throw new HttpError(409, { error: 'invalid_transition', message: error.message });
    }
    throw error;
  }
};

function parseDecideBody(body: unknown): z.infer<typeof DecideBodySchema> {
  const parsed = DecideBodySchema.safeParse(body);
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
