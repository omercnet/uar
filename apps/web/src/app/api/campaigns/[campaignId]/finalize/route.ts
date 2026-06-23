import { type NextRequest, NextResponse } from 'next/server';

import {
  completeCampaign,
  countItems,
  getCampaign,
  loadFinalizeInput,
  withTenantTransaction,
} from '@uar/api';
import { InMemoryFinalizationArtifactStore, finalizeReviewExport } from '@uar/reporting';

import { authenticate, conflict, notFound, requireUuid } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;
  const { campaignId } = await params;

  const id = requireUuid(campaignId, 'campaignId');
  if (id instanceof NextResponse) return id;

  const response = await withTenantTransaction(db, tenantContext.tenantId, async (tx) => {
    const campaign = await getCampaign(tx, tenantContext.tenantId, id);
    if (campaign === undefined) return notFound('not_found', `Campaign ${id} not found`);

    const itemCount = await countItems(tx, tenantContext.tenantId, id);
    if (itemCount === 0) return conflict('campaign_not_reviewable', `Campaign ${id} has no review items to finalize`);

    const input = await loadFinalizeInput(tx, tenantContext.tenantId, campaign);
    const store = new InMemoryFinalizationArtifactStore();
    const result = finalizeReviewExport(input, store);
    const created = campaign.status !== 'completed';
    if (created) await completeCampaign(tx, tenantContext.tenantId, id);
    return NextResponse.json({ contentHash: result.contentHash, created });
  });

  return response;
}
