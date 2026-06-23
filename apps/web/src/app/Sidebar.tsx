'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@descope/nextjs-sdk/client';
import type { ReactNode } from 'react';

function NavItem({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={`nav-link${active ? ' active' : ''}`}>
      {children}
    </Link>
  );
}

export function Sidebar() {
  const { user } = useUser();
  const displayName = user?.name ?? user?.loginIds?.[0] ?? 'Reviewer';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <em>U</em>
        UAR Platform
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <p className="nav-section">Admin</p>
        <NavItem href="/campaigns">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a2 2 0 0 0-4 0v2M8 11h8M8 15h6" />
          </svg>
          Campaigns
        </NavItem>

        <p className="nav-section">Reviewer</p>
        <NavItem href="/review">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          My Assignments
        </NavItem>
      </nav>

      <div className="sidebar-footer">
        <Link href="/settings" className="sidebar-user" aria-label="Account settings">
          {user?.picture ? (
            <img src={user.picture} alt={displayName} className="sidebar-avatar" />
          ) : (
            <span className="sidebar-avatar sidebar-avatar-initials">{initials}</span>
          )}
          <span className="sidebar-username">{displayName}</span>
        </Link>
      </div>
    </aside>
  );
}
