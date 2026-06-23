'use client';

import dynamic from 'next/dynamic';

// Descope component uses browser APIs — must disable SSR
const Descope = dynamic(() => import('@descope/nextjs-sdk').then((m) => m.Descope), {
  ssr: false,
});

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base, #0f1117)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <Descope
          flowId="sign-up-or-in"
          redirectAfterSuccess="/campaigns"
          redirectAfterError="/login"
        />
      </div>
    </div>
  );
}
