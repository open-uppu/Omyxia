'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { api, ApiError, type TenantSummary } from '@/lib/api';

interface TenantSwitcherProps {
  /** Current active tenant. */
  current: TenantSummary;
  /** All tenants the current user is a member of. */
  tenants: TenantSummary[];
  /** Where to send the user to start tenant onboarding from an empty state. */
  onboardingHref?: string;
  /** Called after a successful switch (parent typically does window.location.reload()). */
  onSwitched?: (tenantId: string) => void;
}

/**
 * TenantSwitcher — topbar dropdown listing all user's tenants + "Create new tenant".
 *
 * Behaviour:
 * - Closed by default; clicking the trigger toggles it.
 * - Selecting a tenant calls `POST /api/tenants/:id/switch` and updates the
 *   session cookie (backend responsibility); on success we reload so any
 *   server-rendered tenant-scoped data refreshes.
 * - "Create new tenant" navigates to `onboardingHref`.
 * - Empty state (no tenants) shows a single onboarding CTA.
 */
export function TenantSwitcher({
  current,
  tenants,
  onboardingHref = '/onboarding',
  onSwitched,
}: TenantSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside-click + Escape
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleSelect(tenant: TenantSummary) {
    if (tenant.id === current.id) {
      setOpen(false);
      return;
    }
    setPendingId(tenant.id);
    setError(null);
    try {
      await api.tenants.switch(tenant.id);
      onSwitched?.(tenant.id);
      // Force a full reload so any cached server data refreshes with the new tenant.
      if (typeof window !== 'undefined') window.location.reload();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to switch tenant';
      setError(msg);
      setPendingId(null);
    }
  }

  // Empty state — onboarding CTA
  if (tenants.length === 0) {
    return (
      <div data-testid="tenant-switcher-empty">
        <Button asChild variant="default" size="sm">
          <a href={onboardingHref}>Onboarding</a>
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="tenant-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <span className="truncate max-w-[180px]" data-testid="tenant-switcher-current-name">
          {current.name}
        </span>
        <span className="text-xs text-muted-foreground">{current.role}</span>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch tenant"
          data-testid="tenant-switcher-list"
          className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-md border bg-popover text-popover-foreground shadow-lg focus:outline-none"
        >
          <ul className="max-h-72 overflow-auto py-1">
            {tenants.map((t) => {
              const isCurrent = t.id === current.id;
              const isPending = pendingId === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    aria-current={isCurrent ? 'true' : undefined}
                    data-testid={`tenant-option-${t.id}`}
                    onClick={() => handleSelect(t)}
                    disabled={isPending}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-sm',
                      'hover:bg-accent hover:text-accent-foreground disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    <span className="flex flex-col items-start truncate">
                      <span className="truncate font-medium">{t.name}</span>
                      <span className="text-xs text-muted-foreground">{t.role}</span>
                    </span>
                    {isCurrent && <Check className="h-4 w-4 text-primary" />}
                    {isPending && (
                      <span className="text-xs text-muted-foreground" aria-live="polite">
                        switching…
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t p-1">
            <a
              href={onboardingHref}
              data-testid="tenant-switcher-create"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <Plus className="h-4 w-4" />
              Create new tenant
            </a>
          </div>
          {error && (
            <div
              role="alert"
              className="border-t px-3 py-2 text-xs text-destructive"
              data-testid="tenant-switcher-error"
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TenantSwitcher;
