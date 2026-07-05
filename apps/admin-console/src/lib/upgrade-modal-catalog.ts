/**
 * Upgrade modal — pricing catalog + plan add-ons (P3.4).
 *
 * The modal needs three pieces of data that the FE knows better than
 * the BE for v2.0.0:
 *
 *   1. The price tag for each plan (PRO / ENTERPRISE / add-ons).
 *   2. The human-readable "what you'd get" bullets per plan.
 *   3. The default admin email used for the mailto: CTA.
 *
 * When the BE lands (P1.2 catalog + a future /api/billing/upgrade
 * endpoint) the modal will fetch this dynamically. Until then, this
 * module is the single source of truth on the FE side — both the
 * modal component and the dev-mode 403 interceptor import from here
 * so the displayed prices stay consistent.
 *
 * Conventions:
 *   - All monetary amounts are integers in USD CENTS (no floats —
 *     we never want 0.1 + 0.2 = 0.30000004 bugs in billing UI).
 *   - The plan / add-on labels mirror the seed data shipped in P1.2
 *     (`apps/api/prisma/seed.cjs`) so the BE and FE agree on names.
 *   - The admin email is read from `NEXT_PUBLIC_UPGRADE_ADMIN_EMAIL`
 *     when present (so prod can swap in a real alias without a
 *     rebuild), falling back to `admin@omyxia.app`.
 */

import type {
  AdminPlanSlug,
  UpgradeCatalogRow,
} from '@omyxia/shared-types';

/** Resolve the admin email at runtime — env override or default. */
export function getUpgradeAdminEmail(): string {
  const fromEnv =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_UPGRADE_ADMIN_EMAIL
      : undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'admin@omyxia.app';
}

/**
 * Catalog — kept tiny on purpose. The modal renders the price delta
 * of moving from `currentPlan` → `recommendedPlan` (plus add-ons).
 * Each row corresponds to ONE plan; the modal looks up the row by
 * slug and walks the `includes` array to render the bullets.
 *
 * `FREE` is intentionally absent — the modal only ever compares
 * against paid plans.
 */
export const UPGRADE_CATALOG: Readonly<Record<Exclude<AdminPlanSlug, 'FREE'>, UpgradeCatalogRow>> = {
  PRO: {
    plan: 'PRO',
    planLabel: 'Pro',
    monthlyCents: 9900,
    includes: [
      'Up to 25 users',
      '100 GB storage',
      'Email + Chat + HR modules',
      'Standard support (24h response)',
    ],
    addOns: ['addon.crm', 'addon.bi'],
  },
  ENTERPRISE: {
    plan: 'ENTERPRISE',
    planLabel: 'Enterprise',
    monthlyCents: 49900,
    includes: [
      'Unlimited users',
      'Unlimited storage',
      'All modules (CRM, ERP, WMS, BI, MAS, …)',
      'Priority support (4h response) + SLA',
    ],
    addOns: [],
  },
};

/**
 * Add-on catalog. Mirrors the add-on prices from P1.2 (seed.cjs).
 * `monthlyCents === null` means "contact us" — the modal still
 * lists the add-on but suppresses the price line.
 */
export interface AddOnCatalogRow {
  slug: string;
  label: string;
  monthlyCents: number | null;
  blurb: string;
}

export const UPGRADE_ADDON_CATALOG: ReadonlyArray<AddOnCatalogRow> = [
  {
    slug: 'addon.crm',
    label: 'CRM',
    monthlyCents: 5000,
    blurb: 'Customer 360, sales pipeline, quotes & activities.',
  },
  {
    slug: 'addon.erp',
    label: 'ERP',
    monthlyCents: 8000,
    blurb: 'General ledger, AR/AP, inventory, tax (Thai VAT/WHT).',
  },
  {
    slug: 'addon.wms',
    label: 'WMS',
    monthlyCents: 6000,
    blurb: 'Bin location, barcode, pick/pack, cycle count.',
  },
  {
    slug: 'addon.bi',
    label: 'BI',
    monthlyCents: 4000,
    blurb: 'Real-time KPI dashboards with drill-down.',
  },
  {
    slug: 'addon.mas',
    label: 'MAS',
    monthlyCents: 4500,
    blurb: 'Email/SMS drips, behavior triggers, lead scoring.',
  },
];

/** Look up an add-on by slug (returns undefined if unknown). */
export function findAddOn(slug: string): AddOnCatalogRow | undefined {
  return UPGRADE_ADDON_CATALOG.find((row) => row.slug === slug);
}

/** Look up a plan catalog row by slug (returns undefined for FREE). */
export function findCatalog(plan: AdminPlanSlug): UpgradeCatalogRow | undefined {
  if (plan === 'FREE') return undefined;
  return UPGRADE_CATALOG[plan];
}

/**
 * Compute the price delta between two plans, in cents.
 *
 *   - If either side is FREE we treat it as $0/month (no recurrence).
 *   - If either side has add-ons we add them (we sum the matched
 *     catalog rows). Unknown add-on slugs are skipped silently —
 *     the BE is the source of truth for unknown rows.
 *   - Returns `null` when any add-on is "contact us" (`monthlyCents
 *     === null`) — the modal then renders "Contact admin" without a
 *     price line.
 */
export function computePriceDelta(input: {
  currentPlan: AdminPlanSlug;
  recommendedPlan: AdminPlanSlug;
  requiredAddOns?: ReadonlyArray<string>;
}): number | null {
  const current = input.currentPlan === 'FREE' ? 0 : (UPGRADE_CATALOG[input.currentPlan]?.monthlyCents ?? 0);
  const recommended = input.recommendedPlan === 'FREE' ? 0 : (UPGRADE_CATALOG[input.recommendedPlan]?.monthlyCents ?? 0);
  const addOnDelta = (input.requiredAddOns ?? []).reduce<number | null>((acc, slug) => {
    if (acc === null) return null;
    const row = findAddOn(slug);
    if (!row) return acc;
    if (row.monthlyCents === null) return null;
    return acc + row.monthlyCents;
  }, 0);
  if (addOnDelta === null) return null;
  const baseDelta = recommended - current;
  return baseDelta + addOnDelta;
}

/** Human label for a plan slug (used in the modal header chip). */
export function planLabel(plan: AdminPlanSlug): string {
  if (plan === 'FREE') return 'Free';
  return UPGRADE_CATALOG[plan].planLabel;
}