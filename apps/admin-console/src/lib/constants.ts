/**
 * Sidebar navigation. Centralised so the layout, tests, and any future
 * entitlement-aware filtering (Phase 3.2) read from the same source.
 */

import { LayoutDashboard, Building2, Tags, ScrollText, Settings as SettingsIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  /** Stable key — also used as testid root. */
  key: string;
  /** Display label. */
  label: string;
  /** Route path. */
  href: string;
  /** Lucide icon. */
  icon: LucideIcon;
  /**
   * Optional feature flag key (Phase 3.2 will hide items when the
   * current admin's plan lacks this flag). Empty = always visible.
   */
  feature?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'tenants', label: 'Tenants', href: '/tenants', icon: Building2, feature: 'admin.tenants' },
  { key: 'plans', label: 'Plans', href: '/plans', icon: Tags, feature: 'admin.plans' },
  { key: 'audit', label: 'Audit', href: '/audit', icon: ScrollText },
  { key: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon },
] as const;

export function findNavByHref(href: string): NavItem | undefined {
  // Match by prefix so /tenants/123 still highlights Tenants.
  return NAV_ITEMS.find((item) => href === item.href || href.startsWith(item.href + '/'));
}