'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
  /** Prevents Esc closing (forms in flight). */
  dismissible: boolean;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Dialog>.`);
  }
  return ctx;
}

interface DialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Default true. When false, Esc + backdrop click do not close. */
  dismissible?: boolean;
  children: React.ReactNode;
}

/**
 * Dialog — accessible modal shell used by every editor dialog (P2.5).
 *
 * Behavior:
 *   - role=dialog + aria-modal=true.
 *   - Renders into a portal at the body so it escapes overflow.
 *   - Backdrop click closes (when dismissible).
 *   - Esc closes (when dismissible).
 *   - Focus is trapped inside the dialog while open.
 *
 * The dialog does NOT bundle its own header/body/footer slots — those
 * are added by child elements (`<DialogTitle>`, `<DialogDescription>`,
 * `<DialogContent>`, `<DialogFooter>`) so that the consumers can use
 * arbitrary layouts.
 */
export function Dialog({
  open,
  onOpenChange,
  dismissible = true,
  children,
}: DialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Esc to close (dismissible only).
  React.useEffect(() => {
    if (!open || !dismissible) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissible, onOpenChange]);

  // Focus management — move initial focus inside the dialog on open.
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (!container) return;
    const focusable = container.querySelector<HTMLElement>(
      FOCUSABLE_SELECTOR
    );
    (focusable ?? container).focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Body scroll lock.
  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Focus trap — loop focus inside the dialog when Tab reaches edges.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const ctx: DialogContextValue = {
    open,
    setOpen: onOpenChange,
    titleId,
    descriptionId,
    dismissible,
  };
  return (
    <DialogContext.Provider value={ctx}>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
        onClick={(e) => {
          if (!dismissible) return;
          if (e.target === e.currentTarget) onOpenChange(false);
        }}
        data-testid="dialog-backdrop"
      >
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={cn(
            'relative z-10 w-full max-w-2xl rounded-lg border bg-background shadow-lg outline-none',
            'max-h-[90vh] overflow-y-auto'
          )}
          data-testid="dialog-content"
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { titleId } = useDialogContext('DialogTitle');
  return (
    <h2
      id={titleId}
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { descriptionId } = useDialogContext('DialogDescription');
  if (!children) return null;
  return (
    <p
      id={descriptionId}
      className={cn('text-sm text-muted-foreground', className)}
    >
      {children}
    </p>
  );
}

export function DialogBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('space-y-5 p-6', className)}>{children}</div>;
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:items-center sm:justify-end',
        className
      )}
    >
      {children}
    </div>
  );
}

export function DialogCloseButton({
  className,
  children = 'Close',
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { setOpen } = useDialogContext('DialogCloseButton');
  return (
    <button
      type="button"
      onClick={() => setOpen(false)}
      className={cn(
        'absolute right-4 top-4 rounded-sm text-sm text-muted-foreground',
        'hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      aria-label="Close"
      data-testid="dialog-close"
    >
      {children}
    </button>
  );
}
