import {
  InMemoryFinalizationArtifactStore,
  finalizeReviewExport,
  renderCsvEvidence,
} from '@uar/reporting';

import { withTenantTransaction } from '../../db/tenant-context.js';
import { completeCampaign, getCampaign } from '../../review/campaign-repo.js';
import { loadFinalizeInput } from '../../snapshot/snapshot-repo.js';
import { sendJson, sendText } from '../http-adapter.js';
import { HttpError, type HandlerContext, type RouteHandler } from '../router.js';

type FinalizeResponse = {
  readonly contentHash: string;
  readonly created: boolean;
};

export const finalizeCampaignHandler: RouteHandler = async (ctx) => {
  const tenantId = ctx.tenantContext.tenantId;
  const campaignId = requireCampaignId(ctx);
  const response = await withTenantTransaction(ctx.db, tenantId, async (tx) => {
    const campaign = await getCampaign(tx, tenantId, campaignId);

    if (campaign === undefined) {
      throw missingCampaign(campaignId);
    }

    const input = await loadFinalizeInput(tx, tenantId, campaign);
    const store = new InMemoryFinalizationArtifactStore();
    const result = finalizeReviewExport(input, store);
    const created = campaign.status !== 'completed';

    if (created) {
      await completeCampaign(tx, tenantId, campaignId);
    }

    return { contentHash: result.contentHash, created } satisfies FinalizeResponse;
  });

  sendJson(ctx.res, 200, response);
};

export const exportCampaignCsvHandler: RouteHandler = async (ctx) => {
  const tenantId = ctx.tenantContext.tenantId;
  const campaignId = requireCampaignId(ctx);
  const csv = await withTenantTransaction(ctx.db, tenantId, async (tx) => {
    const campaign = await getCampaign(tx, tenantId, campaignId);

    if (campaign === undefined) {
      throw missingCampaign(campaignId);
    }

    if (campaign.status !== 'completed') {
      throw new HttpError(409, {
        error: 'campaign_not_finalized',
        message: `Campaign ${campaignId} has not been finalized`,
      });
    }

    const input = await loadFinalizeInput(tx, tenantId, campaign);
    const store = new InMemoryFinalizationArtifactStore();
    const result = finalizeReviewExport(input, store);

    return renderCsvEvidence(result.canonicalContent);
  });

  sendText(ctx.res, 200, 'text/csv', csv, {
    'Content-Disposition': `attachment; filename="evidence-${campaignId}.csv"`,
  });
};

function requireCampaignId(ctx: HandlerContext): string {
  const campaignId = ctx.params['campaignId'];

  if (campaignId === undefined || campaignId.length === 0) {
    throw new HttpError(400, {
      error: 'missing_campaign_id',
      message: 'Campaign ID route parameter is required',
    });
  }

  return campaignId;
}

function missingCampaign(campaignId: string): HttpError {
  return new HttpError(404, {
    error: 'not_found',
    message: `Campaign ${campaignId} not found`,
  });
}
