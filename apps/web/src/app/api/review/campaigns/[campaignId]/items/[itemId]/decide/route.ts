import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { applyDecisionAndPersist, listItemsAssignedTo, withTenantTransaction } from '@uar/api';
import { ReviewDecisionActionSchema, ReviewDecisionSchema, ReviewLifecycleTransitionError } from '@uar/core';
import { z } from 'zod';

import { authenticate, badRequest, conflict, notFound, requireUuid } from '@/lib/route-auth';

const Body = z.object({ decision: ReviewDecisionActionSchema, note: z.string(), reviewerName: z.string().optional() });

export async function POST(
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

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest('Invalid request body');

  try {
    const decision = await withTenantTransaction(db, tenantContext.tenantId, async (tx) => {
      const assigned = await listItemsAssignedTo(tx, tenantContext.tenantId, tenantContext.userId);
      const item = assigned.find((i) => i.campaignId === cid && i.reviewItemId === iid);
      if (item === undefined) return notFound('review_item_not_found', `Review item ${iid} not found`);

      const recorded = await applyDecisionAndPersist(tx, tenantContext.tenantId, {
        item,
        decision: {
          decisionId: randomUUID(),
          reviewerUserId: tenantContext.userId,
          reviewerName: parsed.data.reviewerName ?? null,
          decision: parsed.data.decision,
          decidedAt: new Date().toISOString(),
          note: parsed.data.note,
        },
      });
      return ReviewDecisionSchema.parse(recorded);
    });

    if (decision instanceof NextResponse) return decision;
    return NextResponse.json(decision);
  } catch (err) {
    if (err instanceof ReviewLifecycleTransitionError) {
      return conflict('invalid_transition', err.message);
    }
    throw err;
  }
}
