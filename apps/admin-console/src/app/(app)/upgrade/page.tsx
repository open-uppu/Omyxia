'use client';

/**
 * /upgrade — landing page shown when an admin is denied access to a
 * feature (P3.2).
 *
 * Reached two ways:
 *
 *   1. **Auto-redirect from <FeatureGuard>.** The guard builds a URL
 *      like `/upgrade?feature=admin.audit&label=Audit&from=%2Faudit`
 *      and calls `router.replace(target)`. We read those query
 *      params and render the matching `UpgradeHint`-shaped card.
 *
 *   2. **Direct navigation.** An admin may bookmark `/upgrade` to see
 *      the catalog of gated features. In that case there's no
 *      `feature` query param — we render a generic "Browse features"
 *      page that lists what's available on the current plan.
 *
 * The page never throws. Missing query params → fall back to a
 * generic state. Missing entitlements → fall back to PRO as a
 * recommendation.
 *
 * The mailto CTA pre-fills the subject + body with the feature
 * name so the admin can shoot a one-click email to whoever handles
 * plan upgrades (default `admin@omyxia.app` — configurable via
 * NEXT_PUBLIC_UPGRADE_ADMIN_EMAIL).
 */

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Sparkles,
  ArrowLeft,
  Mail,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import {
  useEntitlements,
  navigateToUpgrade,
} from '@/components/entitlements';
import { UpgradeHintSchema, type UpgradeHint } from '@omyxia/shared-types';

const PLAN_RANK: Record<'FREE' | 'PRO' | 'ENTERPRISE', number> = {
  FREE: 0,
  PRO: 1,
  ENTERPRISE: 2,
};

const PLAN_ORDER: ReadonlyArray<'FREE' | 'PRO' | 'ENTERPRISE'> = [
  'FREE',
  'PRO',
  'ENTERPRISE',
];

/**
 * Pick the recommended upgrade plan for a given feature key.
 *
 * Heuristic:
 *   - `admin.audit`         → ENTERPRISE (audit log is enterprise-only)
 *   - `admin.plans`         → PRO      (plan editor is PRO+)
 *   - `module.<anything>`   → PRO
 *   - `limit.<anything>`    → ENTERPRISE (unlimited caps)
 *   - `admin.<other>`       → PRO
 *
 * This is intentionally simple — when the BE catalog lands we can
 * move this logic server-side and read the recommended plan from the
 * same source as the BE `@RequiresFeature` decorator.
 */
function recommendPlanFor(feature: string): 'PRO' | 'ENTERPRISE' {
  if (feature === 'admin.audit') return 'ENTERPRISE';
  if (feature === 'limit.maxUsers' || feature === 'limit.maxStorageGB') {
    return 'ENTERPRISE';
  }
  return 'PRO';
}

/**
 * Build a human-readable feature label from the key when none was
 * passed in the query string. e.g. `module.crm` → `CRM`,
 * `admin.audit` → `Audit`.
 */
function labelFromKey(key: string): string {
  const last = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  // Camel-case → space-separated title-case.
  const spaced = last.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Build the mailto: link for the upgrade CTA.
 *
 * The env variable is read at call time (not import time) so a
 * dev-server restart isn't required when the recipient changes.
 */
function buildMailtoLink(hint: UpgradeHint, adminEmail: string): string {
  const subject = `Upgrade request — ${hint.featureLabel} (current plan: ${hint.currentPlan})`;
  const bodyLines = [
    `Hi,`,
    ``,
    `I'd like to unlock the ${hint.featureLabel} feature on the Omyxia admin console.`,
    ``,
    `Current plan: ${hint.currentPlan}`,
    `Recommended plan: ${hint.recommendedPlan}`,
    hint.from ? `Tried to access: ${hint.from}` : null,
    ``,
    `Thanks,`,
    `<your name>`,
  ].filter(Boolean) as string[];
  const params = new URLSearchParams();
  params.set('subject', subject);
  params.set('body', bodyLines.join('\n'));
  return `mailto:${adminEmail}?${params.toString()}`;
}

export default function UpgradePage() {
  const searchParams = useSearchParams();
  const { entitlements, state } = useEntitlements();
  const upgradeEmail =
    process.env.NEXT_PUBLIC_UPGRADE_ADMIN_EMAIL || 'admin@omyxia.app';

  const featureKey = searchParams?.get('feature') || '';
  const fromHref = searchParams?.get('from') || null;
  const queryLabel = searchParams?.get('label') || null;

  // We prefer the live entitlements payload over the query string
  // for `currentPlan` / `recommendedPlan` — the live data is the
  // source of truth. The query string only carries the feature key
  // and the entry URL.
  const currentPlan = entitlements?.plan ?? 'FREE';
  const recommendedPlan = featureKey ? recommendPlanFor(featureKey) : 'PRO';

  // Only build / validate an UpgradeHint when there's actually a
  // feature to deny. In catalog view (no `feature` query param) we
  // skip the parse — passing `feature: 'unknown'` would fail the
  // regex schema.
  let hint: UpgradeHint | null = null;
  if (featureKey) {
    const featureLabel =
      queryLabel || labelFromKey(featureKey);
    const hintCandidate: UpgradeHint = {
      feature: featureKey as UpgradeHint['feature'],
      featureLabel,
      from: fromHref ?? undefined,
      currentPlan,
      recommendedPlan,
    };
    // Validate at the boundary so any drift from the shared-types
    // surface is caught immediately in dev (the upgrade page is one
    // of the few surfaces that consumes the wire schema end-to-end).
    hint = UpgradeHintSchema.parse(hintCandidate);
  }
  const featureLabel = hint ? hint.featureLabel : 'this feature';

  const planLabel = entitlements?.planLabel ?? 'Free';

  const fromLink = fromHref && fromHref.startsWith('/') ? fromHref : '/dashboard';

  // Catalog view has no specific feature, so the mailto subject/body
  // can't pre-fill a feature name. We still want a CTA — the subject
  // gets a generic copy.
  const mailto = hint
    ? buildMailtoLink(hint, upgradeEmail)
    : `mailto:${upgradeEmail}?${new URLSearchParams({
        subject: 'Upgrade request — Omyxia admin console',
        body: 'Hi,\n\nI would like to upgrade the Omyxia admin console plan.\n\nThanks,',
      }).toString()}`;

  // If there's no `feature` query param, render the catalog view
  // instead of the single-hint view.
  const isCatalogView = !featureKey;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="upgrade-page">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        <span>Plan-gated feature</span>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Sparkles className="h-6 w-6 text-primary" aria-hidden />
              <span data-testid="upgrade-title">{featureLabel}</span>
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="upgrade-subtitle">
              {isCatalogView
                ? 'Browse the features available on your plan, and reach out to unlock more.'
                : `This feature is included in the ${recommendedPlan} plan. You're currently on ${currentPlan}.`}
            </p>
          </div>
        </div>

        {/* Plan chips */}
        <div className="mt-6 flex flex-wrap items-center gap-2" data-testid="upgrade-plans">
          {PLAN_ORDER.map((plan) => {
            const isCurrent = plan === currentPlan;
            const isRecommended = plan === recommendedPlan;
            return (
              <span
                key={plan}
                data-testid={`upgrade-plan-${plan}`}
                data-state={
                  isCurrent
                    ? 'current'
                    : isRecommended
                    ? 'recommended'
                    : 'other'
                }
                className={
                  isCurrent
                    ? 'inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground'
                    : isRecommended
                    ? 'inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                    : 'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground'
                }
              >
                {plan}
                {isCurrent && <span className="text-[10px] uppercase">current</span>}
                {isRecommended && (
                  <span className="text-[10px] uppercase">recommended</span>
                )}
              </span>
            );
          })}
        </div>

        {/* What you'd unlock — a small static list of common unlocks
            per plan. Keeps the page useful even without a BE catalog. */}
        {!isCatalogView && (
          <ul className="mt-6 space-y-2 text-sm" data-testid="upgrade-unlocks">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              <span>Full access to {featureLabel}.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              <span>
                Higher plan caps on{' '}
                {recommendedPlan === 'ENTERPRISE'
                  ? 'users and storage'
                  : 'the modules included in PRO'}
                .
              </span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              <span>Priority support + onboarding assistance.</span>
            </li>
          </ul>
        )}

        {isCatalogView && (
          <CatalogView
            currentPlan={currentPlan}
            entitlementsLoaded={state.kind === 'ok'}
          />
        )}

        {/* CTA row */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href={mailto}
            data-testid="upgrade-cta-mailto"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mail className="h-4 w-4" aria-hidden />
            <span>Contact admin to upgrade</span>
          </a>
          <Link
            href={fromLink}
            data-testid="upgrade-back"
            className="inline-flex items-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>Back</span>
          </Link>
        </div>

        <p className="mt-6 text-[11px] text-muted-foreground">
          Current plan: <strong>{planLabel}</strong>. Your entitlements sync every
          ~5 minutes; refresh the page after upgrading.
        </p>
      </div>
    </div>
  );
}

/**
 * Catalog view — shown when there's no `feature` query param.
 *
 * Renders a compact list of common entitlement keys with their
 * status on the current plan. Real BE-driven catalog data will
 * replace this once the catalog endpoint lands.
 */
function CatalogView({
  currentPlan,
  entitlementsLoaded,
}: {
  currentPlan: 'FREE' | 'PRO' | 'ENTERPRISE';
  entitlementsLoaded: boolean;
}) {
  const catalog: Array<{
    feature: string;
    label: string;
    neededPlan: 'PRO' | 'ENTERPRISE';
  }> = [
    { feature: 'module.crm', label: 'CRM module', neededPlan: 'PRO' },
    { feature: 'module.hr', label: 'HR module', neededPlan: 'PRO' },
    { feature: 'module.bi', label: 'BI dashboards', neededPlan: 'PRO' },
    { feature: 'module.erp', label: 'ERP module', neededPlan: 'ENTERPRISE' },
    { feature: 'module.wms', label: 'Warehouse mgmt', neededPlan: 'ENTERPRISE' },
    { feature: 'admin.audit', label: 'Audit log', neededPlan: 'ENTERPRISE' },
    { feature: 'limit.maxUsers', label: 'Unlimited users', neededPlan: 'ENTERPRISE' },
  ];

  return (
    <ul className="mt-6 divide-y rounded-md border" data-testid="upgrade-catalog">
      {catalog.map((row) => {
        const unlocked =
          entitlementsLoaded && PLAN_RANK[currentPlan] >= PLAN_RANK[row.neededPlan];
        return (
          <li
            key={row.feature}
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            data-testid={`catalog-row-${row.feature}`}
            data-unlocked={unlocked ? 'true' : 'false'}
          >
            <div>
              <div className="font-medium">{row.label}</div>
              <div className="text-xs text-muted-foreground">{row.feature}</div>
            </div>
            <span
              className={
                unlocked
                  ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                  : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
              }
            >
              {unlocked ? 'Included' : `Needs ${row.neededPlan}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}