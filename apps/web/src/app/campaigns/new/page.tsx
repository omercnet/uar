'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createCampaign } from '@/lib/api';
import { getToken } from '@/lib/token';

interface FormState {
  name: string;
  snapshotId: string;
  startsAt: string;
  dueAt: string;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    name: '',
    snapshotId: '',
    startsAt: '',
    dueAt: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const campaign = await createCampaign(
        {
          name: form.name,
          snapshotId: form.snapshotId,
          startsAt: new Date(form.startsAt).toISOString(),
          dueAt: new Date(form.dueAt).toISOString(),
        },
        getToken(),
      );
      router.push(`/campaigns/${campaign.campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/campaigns">Campaigns</Link>
            <span>›</span>
            <span>New</span>
          </div>
          <h1 className="page-title">Create Campaign</h1>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 540 }}>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="card" style={{ overflow: 'visible' }}>
          <div className="card-header">
            <span className="card-title">Campaign Details</span>
          </div>
          <form onSubmit={handleSubmit} style={{ padding: 'var(--s5)' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="name">
                Campaign Name
              </label>
              <input
                id="name"
                className="form-input"
                type="text"
                required
                placeholder="e.g. Q4 2024 Access Review"
                value={form.name}
                onChange={set('name')}
                data-testid="name-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="snapshotId">
                Snapshot ID
              </label>
              <input
                id="snapshotId"
                className="form-input"
                type="text"
                required
                placeholder="Frozen snapshot identifier"
                value={form.snapshotId}
                onChange={set('snapshotId')}
                data-testid="snapshot-id-input"
              />
              <p className="form-hint">
                Only frozen snapshots can be used for campaigns.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="startsAt">
                  Starts At
                </label>
                <input
                  id="startsAt"
                  className="form-input"
                  type="date"
                  required
                  value={form.startsAt}
                  onChange={set('startsAt')}
                  data-testid="starts-at-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="dueAt">
                  Due Date
                </label>
                <input
                  id="dueAt"
                  className="form-input"
                  type="date"
                  required
                  value={form.dueAt}
                  onChange={set('dueAt')}
                  data-testid="due-at-input"
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                data-testid="submit-btn"
              >
                {submitting ? 'Creating…' : 'Create Campaign'}
              </button>
              <Link href="/campaigns" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
