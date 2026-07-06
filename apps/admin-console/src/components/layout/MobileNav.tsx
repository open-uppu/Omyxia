'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { NAV_ITEMS, findNavByHref } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Mobile nav drawer — slides in from the left on viewports <md.
 *
 * We avoid pulling in @radix-ui/react-dialog for v0.1.0 to keep the
 * dependency surface small. The focus-trap is intentionally minimal
 * (Escape + outside-click + close button). A future card can swap in
 * the Radix primitive for full a11y compliance.
 */
export function MobileNav({ open, onClose }: MobileNavProps) {
  const pathname = usePathname() ?? '';
  const active = findNavByHref(pathname);

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
      data-testid="mobile-nav"
      className="fixed inset-0 z-50 md:hidden"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
        data-testid="mobile-nav-backdrop"
      />
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-72 flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              O
            </span>
            <span className="text-sm font-semibold tracking-tight">Omyxia Admin</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close navigation"
            data-testid="mobile-nav-close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Primary navigation (mobile)">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active?.key === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onClose}
                data-testid={`mobile-nav-link-${item.key}`}
                data-active={isActive || undefined}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                  'hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'text-sidebar-foreground/80'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}