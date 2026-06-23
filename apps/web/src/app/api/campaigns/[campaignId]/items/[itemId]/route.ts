import { type NextRequest, NextResponse } from 'next/server';

import { getCampaignItem, withTenantTransaction } from '@uar/api';

import { authenticate, notFound, requireUuid } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string; itemId: string }> },
): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;
  const { campaignId, itemId } = await params;

  const cid = requireUuid(campaignId, 'campaignId');
  if (cid instanceof NextResponse) return cid;
  const iid = requireUuid(itemId, 'itemId');
  if (iid instanceof NextResponse) return iid;

  const item = await withTenantTransaction(db, tenantContext.tenantId, (tx) =>
    getCampaignItem(tx, tenantContext.tenantId, cid, iid),
  );
  if (item === undefined) return notFound('review_item_not_found', `Review item ${iid} not found`);
  return NextResponse.json(item);
}
