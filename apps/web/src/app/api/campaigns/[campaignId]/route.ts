import { type NextRequest, NextResponse } from 'next/server';

import { getCampaign, withTenantTransaction } from '@uar/api';

import { authenticate, notFound, requireUuid } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;
  const { campaignId } = await params;

  const id = requireUuid(campaignId, 'campaignId');
  if (id instanceof NextResponse) return id;

  const campaign = await withTenantTransaction(db, tenantContext.tenantId, (tx) =>
    getCampaign(tx, tenantContext.tenantId, id),
  );
  if (campaign === undefined) return notFound('campaign_not_found', `Campaign ${id} not found`);
  return NextResponse.json(campaign);
}
