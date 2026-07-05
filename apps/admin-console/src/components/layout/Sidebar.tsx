'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, findNavByHref, type NavItem } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useFeature } from '@/components/entitlements';

interface SidebarProps {
  /**
   * Override the active highlight. Defaults to `usePathname()`. Useful
   * for tests that don't render the layout inside Next's router.
   */
  activeHref?: string;
  className?: string;
}

/**
 * Left sidebar — fixed-width vertical nav.
 *
 * Width: 240px on >= md, collapsed to 56px on smaller viewports.
 *
 * Visual rules:
 *  - Active item gets a left accent bar (3px primary) + bold text.
 *  - Hover: subtle accent background.
 *  - Icon + label (icon-only on <md, hidden via Tailwind `md:inline`).
 *  - Hidden on <md by default — the layout wraps it in a Sheet trigger.
 *  - Items whose `feature` flag is `false` are HIDDEN (P3.2). We use
 *    `useFeature()` (default-false while loading) so the user never
 *    sees an item that disappears mid-frame.
 */
export function Sidebar({ activeHref, className }: SidebarProps) {
  const pathname = usePathname() ?? activeHref ?? '';
  const active = findNavByHref(pathname);

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex h-full w-60 flex-col border-r bg-sidebar text-sidebar-foreground',
        'hidden md:flex',
        className
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
        >
          O
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Omyxia Admin</div>
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
            v2.0.0
          </div>
        </div>
      </div>

      <nav
        className="flex-1 space-y-1 overflow-y-auto px-2 py-3"
        aria-label="Primary navigation"
        data-testid="sidebar-nav"
      >
        {NAV_ITEMS.map((item) => (
          <NavItemRow
            key={item.key}
            item={item}
            isActive={active?.key === item.key}
          />
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] leading-tight text-sidebar-foreground/60">
        Super admin actions are audit-logged.
      </div>
    </aside>
  );
}

/**
 * Renders a single NAV_ITEM row. Calls `useFeature(item.feature)`
 * exactly once per row at a stable position so React's Rules of
 * Hooks are satisfied, and returns `null` when the feature is
 * disabled.
 *
 * Items without a `feature` flag (e.g. Dashboard, Settings) are
 * always rendered.
 */
function NavItemRow({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: boolean;
}) {
  // useFeature defaults to `false` while loading — we still render
  // `null` for gated items during the brief loading window so the
  // sidebar doesn't flash every item on first paint. Items without a
  // feature flag skip the check entirely.
  const enabled = useFeature(item.feature ?? '__no_feature__');
  if (item.feature && !enabled) return null;
  return <SidebarLink item={item} isActive={isActive} />;
}

interface SidebarLinkProps {
  item: NavItem;
  isActive: boolean;
}

function SidebarLink({ item, isActive }: SidebarLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-testid={`sidebar-link-${item.key}`}
      data-active={isActive || undefined}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
        isActive
          ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
          : 'text-sidebar-foreground/80'
      )}
    >
      {/* Left accent bar — appears only when active. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0'
        )}
      />
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}