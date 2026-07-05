'use client';

import * as React from 'react';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { UpgradeModalProvider } from '@/components/upgrade/UpgradeModalProvider';
import { UpgradeModal } from '@/components/upgrade/UpgradeModal';
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
 * (app/(app)/layout.tsx). This client component owns the mobile
 * nav state plus the upgrade-modal context (P3.4).
 *
 * Why does the upgrade modal live here, not on individual pages?
 *   - It must be available to EVERY API call (any 403 anywhere
 *     should trigger it). Mounting on the shell means callers can
 *     reach `useUpgradeModal().handleResponse(res)` from anywhere
 *     in the tree.
 *   - It must be rendered ONCE — multiple instances would split
 *     impression state and double-fire `shown` events.
 */
export function AdminShell({ user, children }: AdminShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <UpgradeModalProvider>
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
      {/* Mount the modal at the root so it overlays everything,
          including the mobile nav and any future portals. */}
      <UpgradeModal />
    </UpgradeModalProvider>
  );
}