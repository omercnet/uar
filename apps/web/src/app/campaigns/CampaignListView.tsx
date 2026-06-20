'use client';

import Link from 'next/link';
import type { ReviewCampaign } from '@uar/core';
import { StatusBadge } from '../../components/StatusBadge';

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface Props {
  campaigns: ReviewCampaign[];
}

export function CampaignListView({ campaigns }: Props) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-sub">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/campaigns/new" className="btn btn-primary" data-testid="create-campaign-btn">
          + New Campaign
        </Link>
      </div>

      <div className="page-body">
        <div className="card">
          {campaigns.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No campaigns yet</p>
              <p className="empty-desc">
                Create a campaign to start an access-review cycle.
              </p>
              <div className="empty-actions">
                <Link href="/campaigns/new" className="btn btn-primary">
                  Create your first campaign
                </Link>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table data-testid="campaigns-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Snapshot</th>
                    <th>Starts</th>
                    <th>Due</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.campaignId} data-testid="campaign-row">
                      <td style={{ fontWeight: 500 }}>{campaign.name}</td>
                      <td>
                        <StatusBadge status={campaign.status} />
                      </td>
                      <td>
                        <span className="mono">{campaign.snapshotId}</span>
                      </td>
                      <td className="text-muted">{fmt(campaign.startsAt)}</td>
                      <td className="text-muted">{fmt(campaign.dueAt)}</td>
                      <td>
                        <Link
                          href={`/campaigns/${campaign.campaignId}`}
                          className="btn btn-ghost btn-sm"
                          data-testid="view-campaign-btn"
                        >
                          View →
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
