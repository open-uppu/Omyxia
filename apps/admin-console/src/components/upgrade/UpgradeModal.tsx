'use client';

/**
 * UpgradeModal — the 403 / FEATURE_NOT_INCLUDED modal (P3.4).
 *
 * Spec from the card:
 *   - Shown when API returns 403 FEATURE_NOT_INCLUDED.
 *   - Displays: feature name, current plan, required plan or add-on,
 *     price difference.
 *   - CTA: "Contact admin to upgrade" (mailto: link) + secondary
 *     "View plans" link.
 *   - Dismissible (Esc / X button / backdrop click).
 *   - Tracks impressions (shown / dismissed / cta_clicked).
 *
 * Layout (single column, max-w-md, centered):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  ⚡ Upgrade required              [X]       │
 *   │                                             │
 *   │  CRM requires the Pro plan.                 │
 *   │  [FREE]  →  [PRO]                          │
 *   │                                             │
 *   │  You'd unlock:                              │
 *   │    • Up to 25 users                         │
 *   │    • 100 GB storage                         │
 *   │    • Email + Chat + HR modules              │
 *   │    • Standard support (24h response)        │
 *   │                                             │
 *   │  Price difference:  $99/mo                  │
 *   │                                             │
 *   │  [  Contact admin to upgrade  ]  ← primary  │
 *   │  [  View plans  ]                ← second. │
 *   │                                             │
 *   │  Press Esc to dismiss.                      │
 *   └─────────────────────────────────────────────┘
 *
 * Accessibility:
 *   - role="dialog" + aria-modal=true
 *   - aria-labelledby points at the title
 *   - Focus is trapped inside the dialog while open
 *   - Esc dismisses
 *   - First focusable element is the primary CTA (or X if CTA is
 *     a mailto: anchor without keyboard focus)
 */

import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { ArrowRight, Mail, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useUpgradeModal } from './UpgradeModalProvider';
import {
  computePriceDelta,
  findAddOn,
  findCatalog,
  planLabel as catalogPlanLabel,
} from '@/lib/upgrade-modal-catalog';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function UpgradeModal() {
  const { current, dismiss, trackCtaClick } = useUpgradeModal();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Resolve data for the current payload (or skip rendering).
  const view = useMemo(() => {
    if (!current) return null;
    const targetPlan = findCatalog(current.recommendedPlan);
    // The provider normalises `priceDeltaCents` to either a number
    // or `null`. `null` means "contact us" — the BE explicitly
    // suppressed the price. Any other value means the BE told us
    // the delta in cents. We deliberately do NOT recompute it from
    // the catalog here so the modal mirrors what the BE decided.
    const priceDelta: number | null =
      current.priceDeltaCents === null
        ? null
        : typeof current.priceDeltaCents === 'number'
        ? current.priceDeltaCents
        : computePriceDelta({
            currentPlan: current.currentPlan,
            recommendedPlan: current.recommendedPlan,
            requiredAddOns: current.requiredAddOns,
          });
    const requiredAddOns = (current.requiredAddOns ?? [])
      .map((slug) => findAddOn(slug))
      .filter((row): row is NonNullable<ReturnType<typeof findAddOn>> => Boolean(row));
    return { payload: current, targetPlan, priceDelta, requiredAddOns };
  }, [current]);

  // Move focus to the close button when the modal opens. The user can
  // then Tab to the CTA — keeps the screen-reader announcement clean
  // and avoids accidentally opening the mailto: link with a stray
  // Enter press.
  useEffect(() => {
    if (!current) return;
    // queueMicrotask so the dialog ref is attached.
    queueMicrotask(() => {
      closeButtonRef.current?.focus();
    });
  }, [current]);

  // Esc dismisses; trap Tab inside the dialog while open.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [current, dismiss]);

  // Lock body scroll while the modal is open (prevents the page from
  // scrolling behind it on mobile).
  useEffect(() => {
    if (!current) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [current]);

  if (!view) return null;

  const { payload, targetPlan, priceDelta, requiredAddOns } = view;
  const mailtoHref = buildMailtoHref(payload);
  const hasPrice = priceDelta !== null && priceDelta > 0;
  const includes = targetPlan?.includes ?? [];

  return (
    <div
      data-testid="upgrade-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        // Backdrop click dismisses — but only when the click landed
        // on the backdrop itself (not on a child of the dialog).
        if (e.target === e.currentTarget) dismiss();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
        data-testid="upgrade-modal"
        className="w-full max-w-md overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-2 border-b px-5 py-4">
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="upgrade-modal-title"
                data-testid="upgrade-modal-title"
                className="text-base font-semibold leading-tight"
              >
                Upgrade required
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Your current plan doesn’t include this feature.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Dismiss upgrade modal"
            data-testid="upgrade-modal-close"
            onClick={dismiss}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <div
            className="text-sm"
            data-testid="upgrade-modal-message"
          >
            <span className="font-medium">{payload.featureLabel}</span>{' '}
            requires the{' '}
            <Badge variant="default" data-testid="upgrade-modal-recommended-plan">
              {catalogPlanLabel(payload.recommendedPlan)}
            </Badge>{' '}
            plan.
          </div>

          {/* Current → Recommended */}
          <div
            className="flex items-center gap-2 text-xs"
            data-testid="upgrade-modal-plan-flow"
          >
            <Badge variant="secondary" data-testid="upgrade-modal-current-plan">
              {catalogPlanLabel(payload.currentPlan)}
            </Badge>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Badge variant="default" data-testid="upgrade-modal-recommended-plan-chip">
              {catalogPlanLabel(payload.recommendedPlan)}
            </Badge>
          </div>

          {/* Required add-ons */}
          {requiredAddOns.length > 0 ? (
            <div
              className="rounded-md border bg-muted/40 p-3 text-xs"
              data-testid="upgrade-modal-addons"
            >
              <div className="mb-2 font-medium text-foreground">
                Plus these add-ons:
              </div>
              <ul className="space-y-1">
                {requiredAddOns.map((addon) => (
                  <li
                    key={addon.slug}
                    className="flex items-start gap-2 text-muted-foreground"
                    data-testid={`upgrade-modal-addon-${addon.slug}`}
                  >
                    <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="flex-1">
                      <span className="font-medium text-foreground">{addon.label}</span>
                      {' — '}
                      {addon.blurb}
                      {addon.monthlyCents !== null ? (
                        <span className="ml-1 text-muted-foreground">
                          ({formatCents(addon.monthlyCents, payload.currency)}/mo)
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* "What you'd unlock" bullets */}
          {includes.length > 0 ? (
            <div data-testid="upgrade-modal-includes">
              <div className="mb-2 text-xs font-medium text-foreground">
                You’d unlock:
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {includes.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2"
                    data-testid={`upgrade-modal-include-${slugify(line)}`}
                  >
                    <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="flex-1">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Price line */}
          <div
            className="flex items-baseline justify-between rounded-md border bg-muted/40 px-3 py-2"
            data-testid="upgrade-modal-price"
          >
            <span className="text-xs text-muted-foreground">Price difference</span>
            <span className="text-base font-semibold">
              {hasPrice && priceDelta !== null
                ? `${formatCents(priceDelta, payload.currency)}/mo`
                : 'Contact admin'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-col gap-2 border-t bg-muted/30 px-5 py-4">
          <a
            href={mailtoHref}
            data-testid="upgrade-modal-cta"
            onClick={() => trackCtaClick('mailto')}
            className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Mail className="mr-2 h-4 w-4" aria-hidden />
            Contact admin to upgrade
          </a>
          <a
            href={payload.upgradeUrl}
            data-testid="upgrade-modal-secondary"
            onClick={() => trackCtaClick('in_app_upgrade')}
            className="inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View plans
          </a>
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            Press Esc to dismiss.
          </p>
        </footer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildMailtoHref(payload: {
  featureLabel: string;
  upgradeAdminEmail: string;
  recommendedPlan: string;
  currentPlan: string;
}): string {
  const subject = encodeURIComponent(
    `Upgrade request — ${payload.featureLabel}`
  );
  const body = encodeURIComponent(
    [
      `Hi,`,
      ``,
      `I'd like to upgrade our Omyxia tenant so we can use ${payload.featureLabel}.`,
      ``,
      `Current plan: ${payload.currentPlan}`,
      `Recommended plan: ${payload.recommendedPlan}`,
      ``,
      `Thanks,`,
    ].join('\n')
  );
  return `mailto:${payload.upgradeAdminEmail}?subject=${subject}&body=${body}`;
}

function formatCents(cents: number, currency: string): string {
  // Tiny helper so we don't drag in the dashboard formatter (which is
  // scoped to USD-only display strings and would create a circular
  // import once that module starts loading the catalog).
  if (currency !== 'USD') {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
  const dollars = cents / 100;
  // Whole-dollar amounts render without decimals; sub-dollar amounts
  // render with cents so the modal shows e.g. "$0.50" not "$1".
  return dollars >= 1
    ? `$${Math.round(dollars).toLocaleString('en-US')}`
    : `$${dollars.toFixed(2)}`;
}

/**
 * Slugify a string for use as a `data-testid` suffix. Lowercase +
 * replace non-alphanumeric with `-`. Keeps the modal tests resilient
 * to copy changes (the bullets are mirrored from the catalog).
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}