import { type NextRequest, NextResponse } from 'next/server';

import { updateCampaignStatus, withTenantTransaction } from '@uar/api';
import { ReviewCampaignStatusSchema, ReviewLifecycleTransitionError } from '@uar/core';
import { z } from 'zod';

import { authenticate, badRequest, conflict, notFound, requireUuid } from '@/lib/route-auth';

const Body = z.object({ status: ReviewCampaignStatusSchema });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;
  const { campaignId } = await params;

  const id = requireUuid(campaignId, 'campaignId');
  if (id instanceof NextResponse) return id;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest('Invalid request body');

  try {
    const campaign = await withTenantTransaction(db, tenantContext.tenantId, (tx) =>
      updateCampaignStatus(tx, tenantContext.tenantId, id, parsed.data.status),
    );
    if (campaign === undefined) return notFound('campaign_not_found', `Campaign ${id} not found`);
    return NextResponse.json(campaign);
  } catch (err) {
    if (err instanceof ReviewLifecycleTransitionError) {
      return conflict('invalid_transition', err.message);
    }
    throw err;
  }
}
