import { type NextRequest, NextResponse } from 'next/server';

import { getCampaign, loadFinalizeInput, withTenantTransaction } from '@uar/api';
import { InMemoryFinalizationArtifactStore, finalizeReviewExport, renderCsvEvidence } from '@uar/reporting';

import { authenticate, conflict, notFound, requireUuid } from '@/lib/route-auth';

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

  const result = await withTenantTransaction(db, tenantContext.tenantId, async (tx) => {
    const campaign = await getCampaign(tx, tenantContext.tenantId, id);
    if (campaign === undefined) return notFound('not_found', `Campaign ${id} not found`);
    if (campaign.status !== 'completed') return conflict('campaign_not_finalized', `Campaign ${id} has not been finalized`);

    const input = await loadFinalizeInput(tx, tenantContext.tenantId, campaign);
    const store = new InMemoryFinalizationArtifactStore();
    const finalized = finalizeReviewExport(input, store);
    return renderCsvEvidence(finalized.canonicalContent);
  });

  if (result instanceof NextResponse) return result;

  return new NextResponse(result, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="evidence-${id}.csv"`,
    },
  });
}
