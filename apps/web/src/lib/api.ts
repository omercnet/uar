/**
 * Typed HTTP client for the @uar/api backend.
 *
 * Uses ReviewCampaign / ReviewItem from @uar/core — no duplicated ad-hoc types.
 * All fetch failures return empty collections or null; callers can show empty states.
 */
import type { ReviewCampaign, ReviewCampaignStatus, ReviewDecisionAction, ReviewItem } from '@uar/core';

// All API calls are same-origin Next.js Route Handlers at /api/*

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function listCampaigns(token: string): Promise<ReviewCampaign[]> {
  try {
    const res = await fetch('/api/campaigns', {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as ReviewCampaign[];
  } catch {
    return [];
  }
}

export async function getCampaign(
  campaignId: string,
  token: string,
): Promise<ReviewCampaign | null> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ReviewCampaign;
  } catch {
    return null;
  }
}

export interface CreateCampaignInput {
  name: string;
  snapshotId: string;
  startsAt: string;
  dueAt: string;
}

export async function createCampaign(
  input: CreateCampaignInput,
  token: string,
): Promise<ReviewCampaign> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Create campaign failed: ${res.status}`);
  return (await res.json()) as ReviewCampaign;
}

export async function updateCampaignStatus(
  campaignId: string,
  status: ReviewCampaignStatus,
  token: string,
): Promise<void> {
  const res = await fetch(`/api/campaigns/${campaignId}/status`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Update status failed: ${res.status}`);
}

export async function triggerIngest(campaignId: string, token: string): Promise<void> {
  const res = await fetch(`/api/campaigns/${campaignId}/ingest`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Ingest trigger failed: ${res.status}`);
}

export async function finalizeCampaign(campaignId: string, token: string): Promise<void> {
  const res = await fetch(`/api/campaigns/${campaignId}/finalize`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Finalize failed: ${res.status}`);
}

export async function downloadCsvEvidence(campaignId: string, token: string): Promise<Blob> {
  const res = await fetch(`/api/campaigns/${campaignId}/export.csv`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`CSV export failed: ${res.status}`);
  return res.blob();
}

// ─── Review Items (Admin view) ────────────────────────────────────────────────

export async function listCampaignItems(
  campaignId: string,
  token: string,
): Promise<ReviewItem[]> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/items`, {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as ReviewItem[];
  } catch {
    return [];
  }
}

export async function getCampaignItem(
  campaignId: string,
  itemId: string,
  token: string,
): Promise<ReviewItem | null> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/items/${itemId}`, {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ReviewItem;
  } catch {
    return null;
  }
}

// ─── Reviewer (assigned work) ─────────────────────────────────────────────────

export async function listAssignedCampaigns(token: string): Promise<ReviewCampaign[]> {
  try {
    const res = await fetch('/api/review/campaigns', {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as ReviewCampaign[];
  } catch {
    return [];
  }
}

export async function listAssignedItems(
  campaignId: string,
  token: string,
): Promise<ReviewItem[]> {
  try {
    const res = await fetch(`/api/review/campaigns/${campaignId}/items`, {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as ReviewItem[];
  } catch {
    return [];
  }
}

export interface SubmitDecisionInput {
  decision: ReviewDecisionAction;
  note: string;
}

export async function submitDecision(
  campaignId: string,
  itemId: string,
  input: SubmitDecisionInput,
  token: string,
): Promise<void> {
  const res = await fetch(
    `/api/review/campaigns/${campaignId}/items/${itemId}/decide`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(`Decision submit failed: ${res.status}`);
}
