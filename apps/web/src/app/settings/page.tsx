'use client';

import dynamic from 'next/dynamic';

// Descope UserProfile widget — self-service profile management
// (avatar, display name, email, passkeys, password, etc.)
// Must disable SSR: the web component uses browser APIs.
const UserProfile = dynamic(
  () => import('@descope/nextjs-sdk').then((m) => m.UserProfile),
  { ssr: false },
);

export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Account Settings</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Manage your profile, security, and authentication methods.
          </p>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 640 }}>
        <UserProfile
          widgetId="user-profile-widget"
          theme="dark"
          locale="en"
        />
      </div>
    </>
  );
}
