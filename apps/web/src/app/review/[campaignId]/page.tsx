'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReviewCampaign, ReviewItem } from '@uar/core';
import { StatusBadge } from '@/components/StatusBadge';
import { getCampaign, listAssignedItems } from '@/lib/api';
import { getToken } from '@/lib/token';

export default function ReviewCampaignItemsPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<ReviewCampaign | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    Promise.all([getCampaign(campaignId, token), listAssignedItems(campaignId, token)])
      .then(([camp, itms]) => {
        setCampaign(camp);
        setItems(itms);
      })
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" role="status" aria-label="Loading items" />
      </div>
    );
  }

  const campaignName = campaign?.name ?? campaignId;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/review">My Assignments</Link>
            <span>›</span>
            <span>{campaignName}</span>
          </div>
          <h1 className="page-title">{campaignName}</h1>
          <p className="page-sub">
            {items.length} item{items.length !== 1 ? 's' : ''} to review
          </p>
        </div>
      </div>

      <div className="page-body">
        <div className="card">
          {items.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No items assigned to you</p>
              <p className="empty-desc">
                No review items are currently assigned to you in this campaign.
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const canDecide =
                      item.status === 'assigned' || item.status === 'needs_follow_up';
                    return (
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
                        <td>
                          <Link
                            href={`/review/${campaignId}/${item.reviewItemId}`}
                            className={`btn btn-sm ${canDecide ? 'btn-primary' : 'btn-ghost'}`}
                            data-testid={canDecide ? 'decide-item-btn' : 'view-item-btn'}
                          >
                            {canDecide ? 'Decide →' : 'View'}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
