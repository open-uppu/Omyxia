'use client';

import * as React from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { UserMenu, type UserMenuUser } from './UserMenu';
import { cn } from '@/lib/utils';

interface TopbarProps {
  user: UserMenuUser;
  onOpenMobileNav?: () => void;
  className?: string;
}

/**
 * Topbar — global app chrome for the (app) route group.
 *
 * Layout: [mobile nav trigger] [breadcrumb/title slot] ........... [UserMenu]
 *
 * The breadcrumb/title slot is rendered by the page itself via the
 * `Topbar.Title` helper component. We deliberately don't fetch the page
 * title from `usePathname` here so the page stays in full control.
 */
export function Topbar({ user, onOpenMobileNav, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-14 w-full items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-4 sm:px-6',
        className
      )}
      data-testid="topbar"
    >
      <div className="md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={onOpenMobileNav}
          data-testid="topbar-mobile-nav"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 truncate" data-testid="topbar-title-slot">
        {/* Page-level title rendered here via the <TopbarTitle/> helper. */}
      </div>

      <UserMenu user={user} />
    </header>
  );
}

/**
 * Title helper — drop this inside a page to render the page title in
 * the topbar. It teleports (well, just renders) into the title slot
 * using a portal-free convention: it sets `data-topbar-title` on a span
 * which the topbar will pick up via React context in a future revision.
 *
 * For now (v0.1.0) the simpler behaviour is: each page renders its own
 * <h1> below the topbar, and we leave the title slot empty. The
 * helper exists so pages CAN opt into inline titles without a layout
 * change. v0.2.0+ may switch to a React context (TopbarTitleProvider).
 */
export function TopbarTitle({ children }: { children: React.ReactNode }) {
  return (
    <span data-topbar-title className="truncate text-sm font-medium text-foreground">
      {children}
    </span>
  );
}