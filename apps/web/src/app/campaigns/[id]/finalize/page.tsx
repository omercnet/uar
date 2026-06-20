'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReviewCampaign, ReviewItem } from '@uar/core';
import { StatusBadge } from '@/components/StatusBadge';
import { buildCsvDownloadUrl, finalizeCampaign, getCampaign, listCampaignItems } from '@/lib/api';
import { getToken } from '@/lib/token';

export default function FinalizeCampaignPage() {
  const { id: campaignId } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<ReviewCampaign | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    Promise.all([getCampaign(campaignId, token), listCampaignItems(campaignId, token)])
      .then(([camp, itms]) => {
        setCampaign(camp);
        setItems(itms);
        if (camp?.status === 'completed') setFinalized(true);
      })
      .finally(() => setLoading(false));
  }, [campaignId]);

  async function handleFinalize() {
    const token = getToken();
    setFinalizing(true);
    setError(null);
    try {
      await finalizeCampaign(campaignId, token);
      setFinalized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalization failed');
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="page-body">
        <div className="alert alert-error">Campaign not found.</div>
        <Link href="/campaigns" className="btn btn-ghost">
          ← Back to Campaigns
        </Link>
      </div>
    );
  }

  const decidedCount = items.filter(
    (i) =>
      i.status === 'approved' ||
      i.status === 'revoked' ||
      i.status === 'exception' ||
      i.status === 'needs_follow_up',
  ).length;
  const pendingCount = items.length - decidedCount;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/campaigns">Campaigns</Link>
            <span>›</span>
            <Link href={`/campaigns/${campaignId}`}>{campaign.name}</Link>
            <span>›</span>
            <span>Finalize</span>
          </div>
          <h1 className="page-title">Finalize Campaign</h1>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 560 }}>
        {error && <div className="alert alert-error">{error}</div>}

        {finalized ? (
          <div className="card" style={{ padding: 'var(--s6)' }}>
            <div className="alert alert-success" style={{ marginBottom: 'var(--s5)' }}>
              Campaign finalized. A content-hash artifact has been recorded.
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <a
                href={buildCsvDownloadUrl(campaignId)}
                className="btn btn-success"
                download
                data-testid="download-csv-btn"
              >
                ↓ Download CSV Report
              </a>
              <Link href="/campaigns" className="btn btn-ghost">
                ← Back to Campaigns
              </Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Review Summary</span>
              <StatusBadge status={campaign.status} />
            </div>

            <div className="detail-grid">
              <div className="detail-field">
                <label>Campaign</label>
                <div className="val">{campaign.name}</div>
              </div>
              <div className="detail-field">
                <label>Total Items</label>
                <div className="val">{items.length}</div>
              </div>
              <div className="detail-field">
                <label>Decided</label>
                <div
                  className="val"
                  style={{ color: decidedCount === items.length ? '#34d399' : undefined }}
                >
                  {decidedCount} / {items.length}
                </div>
              </div>
              <div className="detail-field">
                <label>Pending</label>
                <div
                  className="val"
                  style={{ color: pendingCount > 0 ? '#fbbf24' : undefined }}
                >
                  {pendingCount}
                </div>
              </div>
            </div>

            {pendingCount > 0 && (
              <div style={{ padding: '0 var(--s5) var(--s4)' }}>
                <div className="alert alert-info">
                  {pendingCount} item{pendingCount !== 1 ? 's are' : ' is'} still pending.
                  You can finalize anyway — pending items will remain unreviewed in the artifact.
                </div>
              </div>
            )}

            <div
              style={{
                padding: 'var(--s4) var(--s5) var(--s5)',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleFinalize}
                  disabled={finalizing}
                  data-testid="finalize-submit-btn"
                >
                  {finalizing ? 'Finalizing…' : 'Finalize Campaign'}
                </button>
                <Link href={`/campaigns/${campaignId}`} className="btn btn-ghost">
                  Cancel
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
