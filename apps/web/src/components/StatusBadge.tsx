'use client';

import type { ReviewCampaignStatus, ReviewItemStatus } from '@uar/core';

type Status = ReviewCampaignStatus | ReviewItemStatus;

const STATUS_STYLES: Record<Status, { bg: string; text: string; border: string; label: string }> = {
  draft: {
    bg: '#1e2235',
    text: '#7b85a0',
    border: '#2d3350',
    label: 'Draft',
  },
  active: {
    bg: '#0c1f3d',
    text: '#60a5fa',
    border: '#1a3a6e',
    label: 'Active',
  },
  completed: {
    bg: '#0a2318',
    text: '#34d399',
    border: '#14522e',
    label: 'Completed',
  },
  cancelled: {
    bg: '#2a1218',
    text: '#f87171',
    border: '#4a1f28',
    label: 'Cancelled',
  },
  pending: {
    bg: '#231a08',
    text: '#fbbf24',
    border: '#4a3510',
    label: 'Pending',
  },
  assigned: {
    bg: '#0c1f3d',
    text: '#60a5fa',
    border: '#1a3a6e',
    label: 'Assigned',
  },
  approved: {
    bg: '#0a2318',
    text: '#34d399',
    border: '#14522e',
    label: 'Approved',
  },
  revoked: {
    bg: '#2a1218',
    text: '#f87171',
    border: '#4a1f28',
    label: 'Revoked',
  },
  exception: {
    bg: '#1f160a',
    text: '#fb923c',
    border: '#3d2910',
    label: 'Exception',
  },
  needs_follow_up: {
    bg: '#1a0f2a',
    text: '#c084fc',
    border: '#3b1f5e',
    label: 'Needs Follow-up',
  },
};

interface Props {
  status: Status;
}

export function StatusBadge({ status }: Props) {
  const style = STATUS_STYLES[status];
  return (
    <span
      data-testid="status-badge"
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.4px',
        borderRadius: '100px',
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.text,
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}
