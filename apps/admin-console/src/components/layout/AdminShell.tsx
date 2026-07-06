'use client';

import * as React from 'react';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import type { UserMenuUser } from './UserMenu';

interface AdminShellProps {
  user: UserMenuUser;
  children: React.ReactNode;
}

/**
 * AdminShell — outer chrome for every (app)/* page.
 *
 *   ┌─────────┬──────────────────────────────────┐
 *   │ Sidebar │  Topbar                          │
 *   │         ├──────────────────────────────────┤
 *   │         │                                  │
 *   │         │  <main>                         │
 *   │         │                                  │
 *   └─────────┴──────────────────────────────────┘
 *
 * The layout grid is defined by the parent server component
 * (app/(app)/layout.tsx). This client component only owns the mobile
 * nav state — the desktop sidebar is rendered statically next to it.
 */
export function AdminShell({ user, children }: AdminShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background" data-testid="admin-shell">
      <Sidebar />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8" data-testid="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}