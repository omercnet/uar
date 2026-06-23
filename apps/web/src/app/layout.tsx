import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@descope/nextjs-sdk';
import { Sidebar } from './Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'UAR Platform',
  description: 'User Access Review — campaign management and reviewer decision portal',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider projectId={process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID ?? ''}>
          <div className="layout">
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
