'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReviewDecisionAction } from '@uar/core';
import { submitDecision } from '@/lib/api';
import { getToken } from '@/lib/token';

const REVIEW_DECISION_ACTIONS = ['approve', 'revoke', 'exception', 'needs_follow_up'] as const satisfies readonly ReviewDecisionAction[];

type Meta = { label: string; desc: string; cls: string; icon: string };

const DECISION_META = {
  approve: {
    label: 'Approve',
    desc: 'Access is appropriate and should continue.',
    cls: 'decision-approve',
    icon: '✓',
  },
  revoke: {
    label: 'Revoke',
    desc: 'Access should be removed.',
    cls: 'decision-revoke',
    icon: '✕',
  },
  exception: {
    label: 'Exception',
    desc: 'Non-standard access permitted with justification.',
    cls: 'decision-exception',
    icon: '!',
  },
  needs_follow_up: {
    label: 'Needs Follow-up',
    desc: 'More information required before deciding.',
    cls: 'decision-follow-up',
    icon: '?',
  },
} satisfies Record<ReviewDecisionAction, Meta>;

interface Props {
  campaignId: string;
  itemId: string;
  currentStatus?: string;
}

export function DecisionForm({ campaignId, itemId, currentStatus }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReviewDecisionAction | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const alreadyDecided =
    currentStatus === 'approved' ||
    currentStatus === 'revoked' ||
    currentStatus === 'exception';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selected === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitDecision(campaignId, itemId, { decision: selected, note }, getToken());
      setSubmitted(true);
      setTimeout(() => router.push(`/review/${campaignId}`), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision');
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="alert alert-success" role="status">
        Decision submitted successfully. Redirecting…
      </div>
    );
  }

  if (alreadyDecided) {
    return (
      <div className="alert alert-info">
        This item has already been decided ({currentStatus}).
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--s4)' }}>
          {error}
        </div>
      )}

      <div className="decision-grid" style={{ marginBottom: 'var(--s5)' }}>
        {REVIEW_DECISION_ACTIONS.map((action) => {
          const meta: Meta = DECISION_META[action];
          const isSelected = selected === action;
          return (
            <button
              key={action}
              type="button"
              className={`decision-btn ${meta.cls}${isSelected ? ' selected' : ''}`}
              onClick={() => setSelected(action)}
              aria-pressed={isSelected}
              data-testid={`decision-${action}-btn`}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{meta.icon}</span>
              <span style={{ fontWeight: 600 }}>{meta.label}</span>
              <span style={{ fontSize: 11.5, opacity: 0.78, textAlign: 'center' }}>
                {meta.desc}
              </span>
            </button>
          );
        })}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="decision-note">
          Note{' '}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
            (required for Exception / Needs Follow-up)
          </span>
        </label>
        <textarea
          id="decision-note"
          className="form-input"
          rows={3}
          placeholder="Add a justification or additional context…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid="decision-note-input"
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        disabled={selected === null || submitting}
        data-testid="decision-submit-btn"
      >
        {submitting ? 'Submitting…' : 'Submit Decision'}
      </button>
    </form>
  );
}
