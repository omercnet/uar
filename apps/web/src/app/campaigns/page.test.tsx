import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ReviewCampaign } from '@uar/core';
import { CampaignListView } from './CampaignListView';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    'data-testid': testId,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    'data-testid'?: string;
  }) => (
    <a href={String(href)} className={className} data-testid={testId}>
      {children}
    </a>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCampaign(overrides: Partial<ReviewCampaign> = {}): ReviewCampaign {
  return {
    tenantId: 'tenant-1',
    campaignId: 'camp-1',
    name: 'Q4 2024 Access Review',
    snapshotId: 'snap-abc123',
    snapshotLifecycle: 'frozen',
    status: 'draft',
    startsAt: '2024-01-01T00:00:00.000Z',
    dueAt: '2024-01-31T23:59:59.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CampaignListView', () => {
  it('renders campaign name in the table', () => {
    render(<CampaignListView campaigns={[makeCampaign()]} />);
    expect(screen.getByText('Q4 2024 Access Review')).toBeInTheDocument();
  });

  it('renders a status badge for each campaign', () => {
    render(<CampaignListView campaigns={[makeCampaign({ status: 'active' })]} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-status', 'active');
  });

  it('shows the "New Campaign" button', () => {
    render(<CampaignListView campaigns={[]} />);
    expect(screen.getByTestId('create-campaign-btn')).toBeInTheDocument();
  });

  it('shows empty-state message when there are no campaigns', () => {
    render(<CampaignListView campaigns={[]} />);
    expect(screen.getByText(/no campaigns/i)).toBeInTheDocument();
  });

  it('renders a table row for each campaign', () => {
    const campaigns = [
      makeCampaign({ campaignId: 'c1', name: 'Campaign Alpha' }),
      makeCampaign({ campaignId: 'c2', name: 'Campaign Beta' }),
    ];
    render(<CampaignListView campaigns={campaigns} />);
    expect(screen.getAllByTestId('campaign-row')).toHaveLength(2);
  });

  it('shows correct campaign name for multiple campaigns', () => {
    const campaigns = [
      makeCampaign({ campaignId: 'c1', name: 'Campaign Alpha' }),
      makeCampaign({ campaignId: 'c2', name: 'Campaign Beta' }),
    ];
    render(<CampaignListView campaigns={campaigns} />);
    expect(screen.getByText('Campaign Alpha')).toBeInTheDocument();
    expect(screen.getByText('Campaign Beta')).toBeInTheDocument();
  });

  it('links "View" button to the campaign detail page', () => {
    render(<CampaignListView campaigns={[makeCampaign({ campaignId: 'camp-xyz' })]} />);
    const viewBtn = screen.getByTestId('view-campaign-btn');
    expect(viewBtn).toHaveAttribute('href', '/campaigns/camp-xyz');
  });
});
