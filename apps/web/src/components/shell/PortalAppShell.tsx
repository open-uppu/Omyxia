'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, LayoutGrid } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { DynamicNav } from './DynamicNav';
import { ServicePaywallModal } from './ServicePaywallModal';
import {
  PortalEntitlementsProvider,
  usePortalEntitlements,
} from './PortalEntitlementsContext';
import { cn } from '@/lib/utils';
import type { TenantSummary } from '@/lib/api';
import type { ServiceAccessContext } from '@omyxia/shared-types';

export interface PortalUser {
  id: string;
  email: string;
  name: string;
}

export interface PortalAppShellProps {
  user: PortalUser;
  currentTenant: TenantSummary;
  tenants: TenantSummary[];
  entitlementsContext: ServiceAccessContext;
  children: React.ReactNode;
  className?: string;
}

function PortalShellInner({
  user,
  currentTenant,
  tenants,
  children,
  className,
}: Omit<PortalAppShellProps, 'entitlementsContext'>) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { openPaywall } = usePortalEntitlements();

  return (
    <div
      data-testid="portal-app-shell"
      className={cn('flex min-h-screen w-full flex-col bg-background text-foreground', className)}
    >
      {/* Top Navigation Chrome */}
      <div className="relative z-40">
        <Topbar
          user={user}
          currentTenant={currentTenant}
          tenants={tenants}
          logoHref="/dashboard"
        />

        {/* Mobile toggle button bar under Topbar on small screens */}
        <div className="flex md:hidden items-center justify-between border-b px-4 py-2 bg-muted/40">
          <button
            type="button"
            data-testid="mobile-nav-toggle"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md p-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            <span>Microservices Menu</span>
          </button>

          <span className="text-[11px] text-muted-foreground uppercase font-semibold">
            {currentTenant.name}
          </span>
        </div>
      </div>

      {/* Main Body with Sidebar + Content */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop Sidebar */}
        <aside
          data-testid="portal-desktop-sidebar"
          className="hidden md:flex w-64 flex-col border-r bg-card/60 backdrop-blur-sm shrink-0"
        >
          <div className="flex-1 overflow-y-auto py-4">
            <DynamicNav />
          </div>
        </aside>

        {/* Mobile Nav Overlay Drawer */}
        {mobileNavOpen && (
          <div
            role="dialog"
            aria-modal="true"
            data-testid="portal-mobile-drawer"
            className="fixed inset-0 z-50 flex md:hidden bg-background/80 backdrop-blur-sm animate-in fade-in"
          >
            <div className="relative flex w-full max-w-xs flex-1 flex-col bg-card border-r shadow-2xl p-4">
              <div className="flex items-center justify-between pb-3 border-b mb-2">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5 text-primary" />
                  <span className="font-bold text-sm">Omyxia Services</span>
                </div>
                <button
                  type="button"
                  data-testid="mobile-drawer-close"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <DynamicNav onItemClick={() => setMobileNavOpen(false)} />
              </div>
            </div>
          </div>
        )}

        {/* Viewport Main Content */}
        <main
          data-testid="portal-main-content"
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>

      {/* Global Service Paywall Modal */}
      <ServicePaywallModal />
    </div>
  );
}

export function PortalAppShell({
  entitlementsContext,
  ...props
}: PortalAppShellProps) {
  return (
    <PortalEntitlementsProvider initialContext={entitlementsContext}>
      <PortalShellInner {...props} />
    </PortalEntitlementsProvider>
  );
}

export default PortalAppShell;
