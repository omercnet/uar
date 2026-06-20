'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReviewItem } from '@uar/core';
import { StatusBadge } from '@/components/StatusBadge';
import { getCampaignItem } from '@/lib/api';
import { getToken } from '@/lib/token';
import { DecisionForm } from './DecisionForm';

export default function ReviewItemDetailPage() {
  const { campaignId, itemId } = useParams<{ campaignId: string; itemId: string }>();
  const [item, setItem] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    getCampaignItem(campaignId, itemId, token)
      .then(setItem)
      .finally(() => setLoading(false));
  }, [campaignId, itemId]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" role="status" aria-label="Loading item" />
      </div>
    );
  }

  if (!item) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="breadcrumb">
              <Link href="/review">My Assignments</Link>
              <span>›</span>
              <Link href={`/review/${campaignId}`}>Campaign</Link>
              <span>›</span>
              <span>Not found</span>
            </div>
            <h1 className="page-title">Item not found</h1>
          </div>
        </div>
        <div className="page-body">
          <div className="alert alert-error">
            Review item not found or not accessible.
          </div>
          <Link href={`/review/${campaignId}`} className="btn btn-ghost">
            ← Back to Items
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/review">My Assignments</Link>
            <span>›</span>
            <Link href={`/review/${campaignId}`}>Campaign</Link>
            <span>›</span>
            <span>Review Item</span>
          </div>
          <h1 className="page-title">Review Item</h1>
          <div style={{ marginTop: 6 }}>
            <StatusBadge status={item.status} />
          </div>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 680 }}>
        <div className="card" style={{ marginBottom: 'var(--s5)' }}>
          <div className="card-header">
            <span className="card-title">Item Details</span>
          </div>
          <div className="detail-grid">
            <div className="detail-field">
              <label>Access Grant ID</label>
              <div className="val mono">{item.accessGrantId}</div>
            </div>
            <div className="detail-field">
              <label>Application ID</label>
              <div className="val mono">{item.applicationId}</div>
            </div>
            <div className="detail-field">
              <label>Account ID</label>
              <div className="val mono">{item.externalAccountId}</div>
            </div>
            <div className="detail-field">
              <label>Snapshot</label>
              <div className="val mono">{item.snapshotId}</div>
            </div>
            <div className="detail-field">
              <label>Suggested Reviewers</label>
              <div className="val text-sm">
                {item.suggestedReviewerUserIds.length > 0
                  ? item.suggestedReviewerUserIds.join(', ')
                  : '—'}
              </div>
            </div>
            {item.decisionId !== undefined && (
              <div className="detail-field">
                <label>Decision ID</label>
                <div className="val mono">{item.decisionId}</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Submit Decision</span>
          </div>
          <div style={{ padding: 'var(--s5)' }}>
            <DecisionForm
              campaignId={campaignId}
              itemId={itemId}
              currentStatus={item.status}
            />
          </div>
        </div>
      </div>
    </>
  );
}
