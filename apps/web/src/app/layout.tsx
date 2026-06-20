import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
        <div className="layout">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
