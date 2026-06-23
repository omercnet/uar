import type { IncomingMessage, ServerResponse } from 'node:http';

import type { DescopeSessionVerifier } from '../auth/descope.js';
import type { AuthzFlags } from '../config/flags.js';
import type { DatabaseClient } from '../db/client.js';
import { createAuthzMiddleware, type AuthzFailureResponse } from '../middleware/authz.js';
import {
  createCampaignHandler,
  getCampaignHandler,
  getCampaignItemHandler,
  listCampaignItemsHandler,
  listCampaignsHandler,
  updateCampaignStatusHandler,
} from './handlers/campaigns.js';
import { exportCampaignCsvHandler, finalizeCampaignHandler } from './handlers/finalize.js';
import { ingest } from './handlers/ingest.js';
import {
  decideReviewItemHandler,
  getReviewCampaignItemsHandler,
  listReviewCampaignsHandler,
} from './handlers/review.js';
import { sendJson, toAuthzRequest } from './http-adapter.js';
import { createRouter, type HandlerContext, type Route } from './router.js';

export type CreateAppOptions = {
  readonly verifier?: DescopeSessionVerifier;
  readonly flags: AuthzFlags;
  readonly db: DatabaseClient;
};

export function createApp(options: CreateAppOptions): (req: IncomingMessage, res: ServerResponse) => void {
  if (!options.flags.stubAuthz && options.verifier === undefined) {
    throw new Error('DESCOPE_PROJECT_ID is required unless STUB_AUTHZ=true');
  }

  const middleware = createAuthzMiddleware({
    verifier: options.verifier ?? stubVerifier,
    flags: options.flags,
  });

  return createRouter(createRouteTable(), {
    contextFactory: async (req, res, params, url) => {
      const result = await middleware(toAuthzRequest(req), (authorizedRequest) =>
        ({
          tenantContext: authorizedRequest.tenantContext,
          db: options.db,
          req,
          res,
          params,
          url,
        }) satisfies HandlerContext,
      );

      if (isAuthzFailureResponse(result)) {
        sendJson(res, result.status, result.body);
        return undefined;
      }

      return result;
    },
  });
}

function createRouteTable(): readonly Route[] {
  return [
    { method: 'GET', path: '/campaigns', handler: listCampaignsHandler },
    { method: 'POST', path: '/campaigns', handler: createCampaignHandler },
    { method: 'GET', path: '/campaigns/:campaignId', handler: getCampaignHandler },
    { method: 'PATCH', path: '/campaigns/:campaignId/status', handler: updateCampaignStatusHandler },
    { method: 'POST', path: '/campaigns/:campaignId/ingest', handler: ingest },
    { method: 'POST', path: '/campaigns/:campaignId/finalize', handler: finalizeCampaignHandler },
    { method: 'GET', path: '/campaigns/:campaignId/export.csv', handler: exportCampaignCsvHandler },
    { method: 'GET', path: '/campaigns/:campaignId/items', handler: listCampaignItemsHandler },
    { method: 'GET', path: '/campaigns/:campaignId/items/:itemId', handler: getCampaignItemHandler },
    { method: 'GET', path: '/review/campaigns', handler: listReviewCampaignsHandler },
    { method: 'GET', path: '/review/campaigns/:campaignId/items', handler: getReviewCampaignItemsHandler },
    { method: 'POST', path: '/review/campaigns/:campaignId/items/:itemId/decide', handler: decideReviewItemHandler },
  ];
}

function isAuthzFailureResponse(result: HandlerContext | AuthzFailureResponse): result is AuthzFailureResponse {
  return 'status' in result;
}

const stubVerifier: DescopeSessionVerifier = {
  verifySessionToken: () => Promise.reject(new Error('Descope verifier is not configured')),
};
