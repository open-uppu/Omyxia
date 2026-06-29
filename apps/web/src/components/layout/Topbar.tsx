'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TenantSwitcher } from '@/components/tenant/TenantSwitcher';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { TenantSummary } from '@/lib/api';

interface TopbarUser {
  id: string;
  email: string;
  name: string;
}

interface TopbarProps {
  user: TopbarUser;
  currentTenant: TenantSummary;
  tenants: TenantSummary[];
  logoHref?: string;
  className?: string;
}

/**
 * Topbar — global app chrome.
 * Layout: [Logo] [TenantSwitcher] ........... [User menu]
 *
 * Mobile-responsive: collapses user-name to icon-only on narrow viewports
 * via Tailwind utility classes (md:inline / hidden).
 *
 * Sign-out: POST /api/auth/logout, then redirect to /login.
 */
export function Topbar({
  user,
  currentTenant,
  tenants,
  logoHref = '/dashboard',
  className,
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await api.auth.logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } catch {
      // Backend may already have cleared the session — redirect anyway.
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
  }

  const initials = (user.name || user.email).slice(0, 1).toUpperCase();

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
      data-testid="topbar"
    >
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
        {/* Logo */}
        <Link
          href={logoHref}
          className="flex items-center gap-2 font-semibold tracking-tight"
          data-testid="topbar-logo"
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            O
          </span>
          <span className="hidden sm:inline">Omyxia</span>
        </Link>

        {/* Tenant switcher */}
        <div className="ml-1 sm:ml-3">
          <TenantSwitcher current={currentTenant} tenants={tenants} />
        </div>
        <nav className="ml-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/audit" className="hover:text-foreground" data-testid="nav-audit">
            Audit
          </Link>
        </nav>

        <div className="flex-1" />

        {/* User menu */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="topbar-user-trigger"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground"
            >
              {initials}
            </span>
            <span className="hidden md:inline truncate max-w-[140px]">
              {user.name || user.email}
            </span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              data-testid="topbar-user-menu"
              className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-md border bg-popover text-popover-foreground shadow-lg focus:outline-none"
            >
              <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                <div className="truncate font-medium text-foreground" data-testid="topbar-user-name">
                  {user.name || user.email}
                </div>
                <div className="truncate">{user.email}</div>
              </div>
              <div className="py-1">
                <Link
                  href="/account"
                  role="menuitem"
                  data-testid="topbar-menu-account"
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <UserIcon className="h-4 w-4" />
                  Account
                </Link>
                <Link
                  href="/settings"
                  role="menuitem"
                  data-testid="topbar-menu-settings"
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </div>
              <div className="border-t p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  data-testid="topbar-sign-out"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Topbar;
