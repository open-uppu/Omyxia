'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import { cn, initialsOf } from '@/lib/utils';

export interface UserMenuUser {
  id: string;
  email: string;
  name: string;
  role: 'super_admin';
}

interface UserMenuProps {
  user: UserMenuUser;
  className?: string;
  /** Optional callback — defaults to the global window.location redirect. */
  onSignOut?: () => void;
}

/**
 * Top-right user menu — name + avatar circle + chevron. Click reveals a
 * popover with the user's email, role badge, and Sign out button.
 *
 * The button is the keyboard anchor (Tab/Shift+Tab/Enter/Space). The
 * menu traps Escape to close, and an outside-click handler closes it.
 */
export function UserMenu({ user, className, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
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

  function handleSignOut() {
    setOpen(false);
    if (onSignOut) {
      onSignOut();
      return;
    }
    // Default behaviour: clear cookie + redirect.
    if (typeof document !== 'undefined') {
      document.cookie = 'admin_session=; Path=/; Max-Age=0; SameSite=Strict';
    }
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(
      () => undefined
    );
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  const initials = initialsOf(user.name, user.email);

  return (
    <div ref={menuRef} className={cn('relative', className)} data-testid="user-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
      >
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground"
        >
          {initials}
        </span>
        <span className="hidden md:inline truncate max-w-[140px]">{user.name || user.email}</span>
        <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="user-menu-popover"
          className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-md border bg-popover text-popover-foreground shadow-lg focus:outline-none"
        >
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            <div
              className="truncate font-medium text-foreground"
              data-testid="user-menu-name"
            >
              {user.name || user.email}
            </div>
            <div className="truncate" data-testid="user-menu-email">
              {user.email}
            </div>
            <div className="mt-1 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {user.role}
            </div>
          </div>
          <div className="p-1">
            <button
              type="button"
              role="menuitem"
              data-testid="user-menu-sign-out"
              onClick={handleSignOut}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm',
                'hover:bg-accent hover:text-accent-foreground',
                'focus-visible:outline-none focus-visible:bg-accent'
              )}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}