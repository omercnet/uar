'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReviewCampaign, ReviewItem } from '@uar/core';
import { StatusBadge } from '@/components/StatusBadge';
import {
  buildCsvDownloadUrl,
  getCampaign,
  listCampaignItems,
  triggerIngest,
  updateCampaignStatus,
} from '@/lib/api';
import { getToken } from '@/lib/token';

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function CampaignDetailPage() {
  const { id: campaignId } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<ReviewCampaign | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    setLoading(true);
    Promise.all([getCampaign(campaignId, token), listCampaignItems(campaignId, token)])
      .then(([camp, itms]) => {
        setCampaign(camp);
        setItems(itms);
      })
      .finally(() => setLoading(false));
  }, [campaignId]);

  async function handleActivate() {
    const token = getToken();
    setActionPending(true);
    setActionError(null);
    try {
      await updateCampaignStatus(campaignId, 'active', token);
      const camp = await getCampaign(campaignId, token);
      setCampaign(camp);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setActionPending(false);
    }
  }

  async function handleIngest() {
    const token = getToken();
    setActionPending(true);
    setActionError(null);
    try {
      await triggerIngest(campaignId, token);
      const itms = await listCampaignItems(campaignId, token);
      setItems(itms);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setActionPending(false);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" role="status" aria-label="Loading campaign" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="breadcrumb">
              <Link href="/campaigns">Campaigns</Link>
              <span>›</span>
              <span>Not found</span>
            </div>
            <h1 className="page-title">Campaign not found</h1>
          </div>
        </div>
        <div className="page-body">
          <div className="alert alert-error">
            Campaign not found or you don&apos;t have access.
          </div>
          <Link href="/campaigns" className="btn btn-ghost">
            ← Back to Campaigns
          </Link>
        </div>
      </>
    );
  }

  const decidedCount = items.filter(
    (i) =>
      i.status === 'approved' ||
      i.status === 'revoked' ||
      i.status === 'exception' ||
      i.status === 'needs_follow_up',
  ).length;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/campaigns">Campaigns</Link>
            <span>›</span>
            <span>{campaign.name}</span>
          </div>
          <h1 className="page-title">{campaign.name}</h1>
          <div style={{ marginTop: 6 }}>
            <StatusBadge status={campaign.status} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
          {campaign.status === 'draft' && (
            <button
              className="btn btn-primary"
              onClick={handleActivate}
              disabled={actionPending}
              data-testid="activate-btn"
            >
              {actionPending ? 'Activating…' : 'Activate Campaign'}
            </button>
          )}
          {campaign.status === 'active' && (
            <>
              <button
                className="btn btn-ghost"
                onClick={handleIngest}
                disabled={actionPending}
                data-testid="ingest-btn"
              >
                {actionPending ? 'Ingesting…' : 'Trigger Ingest'}
              </button>
              <Link
                href={`/campaigns/${campaign.campaignId}/finalize`}
                className="btn btn-primary"
                data-testid="finalize-btn"
              >
                Finalize →
              </Link>
            </>
          )}
          {campaign.status === 'completed' && (
            <a
              href={buildCsvDownloadUrl(campaign.campaignId)}
              className="btn btn-success"
              download
              data-testid="download-csv-btn"
            >
              ↓ Download CSV
            </a>
          )}
        </div>
      </div>

      <div className="page-body">
        {actionError && <div className="alert alert-error">{actionError}</div>}

        <div className="stats-row">
          <div className="stat-box">
            <div className="stat-label">Total Items</div>
            <div className="stat-val">{items.length}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Decided</div>
            <div className="stat-val">{decidedCount}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Pending</div>
            <div className="stat-val">{items.length - decidedCount}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Due</div>
            <div className="stat-val" style={{ fontSize: 18 }}>
              {fmt(campaign.dueAt)}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Review Items</span>
            <span className="text-muted text-sm">{items.length} items</span>
          </div>
          {items.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No items yet</p>
              <p className="empty-desc">
                Trigger an ingest to generate review items from the snapshot.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table data-testid="review-items-table">
                <thead>
                  <tr>
                    <th>Access Grant</th>
                    <th>Application</th>
                    <th>Account</th>
                    <th>Status</th>
                    <th>Suggested Reviewers</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.reviewItemId} data-testid="review-item-row">
                      <td>
                        <span className="mono">{item.accessGrantId}</span>
                      </td>
                      <td>
                        <span className="mono">{item.applicationId}</span>
                      </td>
                      <td>
                        <span className="mono">{item.externalAccountId}</span>
                      </td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="text-muted text-sm">
                        {item.suggestedReviewerUserIds.join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
