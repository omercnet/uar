'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReviewCampaign } from '@uar/core';
import { StatusBadge } from '@/components/StatusBadge';
import { listAssignedCampaigns } from '@/lib/api';
import { getToken } from '@/lib/token';

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ReviewDashboardPage() {
  const [campaigns, setCampaigns] = useState<ReviewCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    listAssignedCampaigns(token)
      .then(setCampaigns)
      .catch(() => { /* api client returns [] on error */ })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" role="status" aria-label="Loading assignments" />
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Assignments</h1>
          <p className="page-sub">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} assigned to you
          </p>
        </div>
      </div>

      <div className="page-body">
        <div className="card">
          {campaigns.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No assignments</p>
              <p className="empty-desc">
                You haven&apos;t been assigned to any active review campaigns yet.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.campaignId} data-testid="assigned-campaign-row">
                      <td style={{ fontWeight: 500 }}>{campaign.name}</td>
                      <td>
                        <StatusBadge status={campaign.status} />
                      </td>
                      <td className="text-muted">{fmt(campaign.dueAt)}</td>
                      <td>
                        <Link
                          href={`/review/${campaign.campaignId}`}
                          className="btn btn-primary btn-sm"
                          data-testid="review-campaign-btn"
                        >
                          Review →
                        </Link>
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
