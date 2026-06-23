import { type NextRequest, NextResponse } from 'next/server';

import { withTenantTransaction, createCampaignWithSnapshot, listCampaigns } from '@uar/api';
import { z } from 'zod';

import { authenticate, badRequest } from '@/lib/route-auth';

const CreateCampaignBodySchema = z.object({
  name: z.string().min(1),
  snapshotId: z.string().min(1),
  startsAt: z.iso.datetime().transform((v) => new Date(v)),
  dueAt: z.iso.datetime().transform((v) => new Date(v)),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;

  const campaigns = await withTenantTransaction(db, tenantContext.tenantId, (tx) =>
    listCampaigns(tx, tenantContext.tenantId),
  );
  return NextResponse.json(campaigns);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;
  const { tenantContext, db } = auth;

  const parsed = CreateCampaignBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest('Invalid request body');

  const campaign = await withTenantTransaction(db, tenantContext.tenantId, (tx) =>
    createCampaignWithSnapshot(tx, tenantContext.tenantId, parsed.data),
  );
  return NextResponse.json(campaign, { status: 201 });
}
