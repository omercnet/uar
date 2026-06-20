'use client';

import { useEffect, useState } from 'react';
import type { ReviewCampaign } from '@uar/core';
import { listCampaigns } from '@/lib/api';
import { getToken } from '@/lib/token';
import { CampaignListView } from './CampaignListView';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<ReviewCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    listCampaigns(token)
      .then(setCampaigns)
      .catch(() => { /* errors return empty array from api client */ })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" role="status" aria-label="Loading campaigns" />
      </div>
    );
  }

  return <CampaignListView campaigns={campaigns} />;
}
