import { type NextRequest, NextResponse } from 'next/server';

import { listItemsAssignedTo, withTenantTransaction } from '@uar/api';

import { authenticate, requireUuid } from '@/lib/route-auth';

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

  const items = await withTenantTransaction(db, tenantContext.tenantId, async (tx) => {
    const all = await listItemsAssignedTo(tx, tenantContext.tenantId, tenantContext.userId);
    return all.filter((item) => item.campaignId === id);
  });

  return NextResponse.json(items);
}
