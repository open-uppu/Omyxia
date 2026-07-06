/**
 * Upgrade modal wire format (P3.4).
 *
 * Lives in `@omyxia/shared-types` so:
 *   - The frontend modal renders the same shape regardless of the
 *     upstream producer (dev mock today, BE tomorrow).
 *   - The impression-tracking analytics sink (P3.x follow-on) accepts
 *     the same payload.
 *   - Tests can zod-validate rendered output without spinning up React.
 *
 * Trigger:
 *   The modal pops up whenever an admin API call returns 403 with
 *   `error: 'FEATURE_NOT_INCLUDED'`. The 403 payload looks like:
 *
 *     {
 *       statusCode: 403,
 *       error: 'FEATURE_NOT_INCLUDED',
 *       feature: 'module.crm',
 *       featureLabel: 'CRM',
 *       currentPlan: 'FREE',
 *       recommendedPlan: 'PRO',
 *       requiredAddOns: [],          // optional; CRM as a Pro add-on
 *       priceDeltaCents: 9900,       // monthly delta in USD cents
 *       currency: 'USD',
 *       upgradeAdminEmail: 'admin@omyxia.app',
 *       upgradeUrl: '/upgrade?feature=module.crm',
 *       from: '/tenants'             // optional, for the "Back" link
 *     }
 *
 * The FE never blocks on the modal — dismissing it leaves the user
 * back where they were. We also never assume the BE exists yet, so
 * the dev-mode `useUpgradeModal` hook ships a local fallback that
 * fabricates an `UpgradeModalPayload` for any 403 it sees in tests.
 *
 * This module is intentionally pure-data — no React, no fetch — so
 * the API route, the modal component, and the analytics sink can all
 * import it without dragging in hooks.
 */

import { z } from 'zod';
import { AdminPlanSlugSchema } from './admin-metrics';

// ----------------------------------------------------------------------------
// Add-on slug — separate enum from plan slugs because add-ons live in
// their own catalog (P1.2) and a single feature may map to multiple
// add-ons. We keep the wire shape string-flexible (regex) so adding a
// new add-on to the BE catalog doesn't break the FE schema.
// ----------------------------------------------------------------------------

/**
 * Add-on key shape: `addon.<lowercase>` — mirrors the P1.2 add-on
 * catalog (CRM, ERP, WMS, BI, MAS, …).
 */
export const AddOnSlugSchema = z.string().regex(/^addon\.[a-z][a-z0-9_.-]*$/);
export type AddOnSlug = z.infer<typeof AddOnSlugSchema>;

/**
 * Catalog row — what's currently for sale. Powers both the price
 * delta math and the "what you'd get" bullets in the modal.
 *
 *   - `monthlyCents` — recurring per-tenant price, USD cents.
 *   - `addOns`       — optional add-ons that unlock this feature
 *                      (e.g. CRM is part of Pro; MAS is a paid add-on
 *                      on top of Pro). Empty array = plan alone is
 *                      enough.
 *
 * The card scope is intentionally small — just enough for the modal
 * to render the price difference line ("$99/mo to upgrade from Free
 * to Pro"). The full catalog (P1.2) is the source of truth; this
 * mirror exists so the FE can render the delta without a round-trip.
 */
export const UpgradeCatalogRowSchema = z.object({
  plan: AdminPlanSlugSchema,
  /** Display label for the plan chip — e.g. "Pro", "Enterprise". */
  planLabel: z.string(),
  /** Monthly recurring price in USD cents. 0 means "contact us". */
  monthlyCents: z.number().int().nonnegative(),
  /** What this plan unlocks in plain English (rendered as bullets). */
  includes: z.array(z.string()),
  /** Optional add-on slugs that pair with this plan. */
  addOns: z.array(AddOnSlugSchema).default([]),
});

export type UpgradeCatalogRow = z.infer<typeof UpgradeCatalogRowSchema>;

// ----------------------------------------------------------------------------
// The 403 payload — what the API returns.
// ----------------------------------------------------------------------------

/**
 * 403 response body that triggers the upgrade modal.
 *
 * Conventions:
 *   - `statusCode` is required because we may receive other 403 shapes
 *     (e.g. `forbidden` for non-tenant errors) and we don't want to
 *     open the modal for those.
 *   - `featureLabel` is rendered verbatim; the BE owns human-readable
 *     copy so the FE doesn't have to maintain a label table.
 *   - `upgradeAdminEmail` is REQUIRED and MUST be a valid `mailto:`
 *     anchor target (or bare email — the FE prepends `mailto:` if
 *     missing). This is the primary CTA.
 *   - `priceDeltaCents` and `currency` are optional — the modal still
 *     works without them (renders "Contact admin to upgrade" instead
 *     of a price). Some features (legacy / custom) intentionally
 *     suppress the price.
 */
export const FeatureDeniedSchema = z.object({
  statusCode: z.literal(403),
  /** Machine-readable error code — must equal 'FEATURE_NOT_INCLUDED'. */
  error: z.literal('FEATURE_NOT_INCLUDED'),
  /** The feature key that was denied. */
  feature: z.string(),
  /** Human-readable label. */
  featureLabel: z.string(),
  /** Current plan the admin's tenant is on. */
  currentPlan: AdminPlanSlugSchema,
  /** Plan slug that unlocks this feature (best-fit target). */
  recommendedPlan: AdminPlanSlugSchema,
  /** Add-on slugs the BE recommends alongside the plan bump. */
  requiredAddOns: z.array(AddOnSlugSchema).default([]),
  /** Price difference in USD cents (monthly delta). null = "Contact us". */
  priceDeltaCents: z.number().int().nullable().default(null),
  /** Currency code — defaults to 'USD'. */
  currency: z.string().default('USD'),
  /** Email of the upgrade admin (super_admin address). Required. */
  upgradeAdminEmail: z.string().email(),
  /** Deep link to the upgrade page. Always rendered as a secondary CTA. */
  upgradeUrl: z.string().default('/upgrade'),
  /** URL the user came from (for the "Back to <X>" affordance). */
  from: z.string().optional(),
  /** ISO timestamp — server clock when the 403 was generated. */
  generatedAt: z.string().optional(),
});

export type FeatureDenied = z.infer<typeof FeatureDeniedSchema>;

// ----------------------------------------------------------------------------
// Impression event — what we send to the analytics sink on show/dismiss.
// ----------------------------------------------------------------------------

/**
 * Impression event kinds:
 *   - `shown`        — modal became visible (after the open animation).
 *   - `dismissed`    — user closed without clicking the CTA.
 *   - `cta_clicked`  — user clicked "Contact admin to upgrade" /
 *                       mailto: link / secondary "Open upgrade page".
 *   - `plan_viewed`  — user opened the secondary upgrade page link.
 *
 * The `feature` field is duplicated (it's also in `featureDenied`) so
 * the analytics sink can index by feature without joining.
 */
export const UpgradeImpressionKindSchema = z.enum([
  'shown',
  'dismissed',
  'cta_clicked',
  'plan_viewed',
]);

export type UpgradeImpressionKind = z.infer<typeof UpgradeImpressionKindSchema>;

export const UpgradeImpressionSchema = z.object({
  /** Which interaction triggered this event. */
  kind: UpgradeImpressionKindSchema,
  /** The feature that was denied. */
  feature: z.string(),
  /** When the modal was first shown (ISO). Set on every event. */
  shownAt: z.string(),
  /** When this specific event fired (ISO). */
  at: z.string(),
  /** Current plan / recommended plan — mirrors the denied payload. */
  currentPlan: AdminPlanSlugSchema,
  recommendedPlan: AdminPlanSlugSchema,
  /** Was the email CTA or the in-app upgrade page used? */
  ctaTarget: z.enum(['mailto', 'in_app_upgrade']).optional(),
});

export type UpgradeImpression = z.infer<typeof UpgradeImpressionSchema>;