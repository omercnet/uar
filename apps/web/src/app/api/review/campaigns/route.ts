import { type NextRequest, NextResponse } from 'next/server';

import { getCampaign, listCampaignsAssignedTo, withTenantTransaction } from '@uar/api';

import { authenticate } from '@/lib/route-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;

  const campaigns = await withTenantTransaction(db, tenantContext.tenantId, async (tx) => {
    const ids = await listCampaignsAssignedTo(tx, tenantContext.tenantId, tenantContext.userId);
    const loaded = await Promise.all(ids.map((cid) => getCampaign(tx, tenantContext.tenantId, cid)));
    return loaded.filter((c) => c !== undefined);
  });

  return NextResponse.json(campaigns);
}
