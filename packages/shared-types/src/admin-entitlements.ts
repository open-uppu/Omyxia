/**
 * Tenant + admin entitlement wire format (P3.2).
 *
 * Lives in `@omyxia/shared-types` so:
 *   - The admin-console frontend can validate shapes at runtime (zod).
 *   - The future backend producer for `GET /api/entitlements/me` (the
 *     owner of this card's data, P1.x time-series expansion after
 *     P1.1 lands) returns the same shape verbatim.
 *
 * Concept map:
 *   - `features`:  boolean flags  →  "is module X enabled for this admin/tenant?"
 *   - `limits`:    numeric caps   →  "what's the max quota for resource Y?"
 *                  `null` means unlimited (e.g. ENTERPRISE `limit.maxUsers = null`).
 *   - `plan`:      the source of truth for "tier" display.
 *
 * The same wire format is used by:
 *   - `useFeature(key)`  → reads `features[key]`
 *   - `useLimit(key)`    → reads `limits[key]`
 *   - The sidebar nav filter (`NAV_ITEMS[].feature`).
 *   - The route guard (`<FeatureGuard feature=…>`).
 *
 * Why two value shapes (boolean + numeric)?
 *   The P3.5 backend decorator `@RequiresFeature({key, kind})` accepts
 *   both — `kind: 'module'` for flags and `kind: 'limit'` for numeric
 *   quotas. Mirroring it here keeps the FE types and the BE decorator
 *   in lock-step. When P3.1 lands, the catalog is the same set of keys.
 *
 * Conventions:
 *   - `null` limit means "unlimited" (ENTERPRISE tier).
 *   - Missing `features[key]` is treated as `false` by the hook
 *     (defensive default — never accidentally grant access because
 *     the payload was missing a key).
 *   - Missing `limits[key]` is treated as `null` (unlimited) for
 *     parity with the BE `@RequiresFeature({kind:'limit'})` default.
 *     The `useLimit()` hook documents this behaviour.
 *   - `plan` is required so the UI can render "Pro — Upgrade to
 *     Enterprise for unlimited storage" without a separate endpoint.
 *
 * This module is intentionally pure-data — no React, no hooks, no
 * environment reads — so it can be imported from both the React tree
 * and the Node API route handlers.
 */

import { z } from 'zod';
import { AdminPlanSlugSchema } from './admin-metrics';

// ----------------------------------------------------------------------------
// Feature keys — the canonical catalog used by the FE hooks, the sidebar
// nav filter, and (when P3.1 lands) the BE `@RequiresFeature` decorator.
// Mirrors `apps/api/src/modules/feature-gating/__fixtures__/feature-catalog.ts`.
//
// We declare them as a string-validated enum rather than `z.enum([...])`
// so that NEW feature keys can be added without a breaking schema change.
// The BE catalog is the source of truth; if you add a key here that the
// BE doesn't know about, `useFeature()` returns `false`. If you add a
// key on the BE without updating this file, the FE still works (just
// treats the missing key as `false`).
// ----------------------------------------------------------------------------

/**
 * Module flags — boolean "is this module enabled?".
 *
 * Keys follow the catalog in
 * `apps/api/src/modules/feature-gating/__fixtures__/feature-catalog.ts`:
 *   - `module.<name>`           — short, all-lowercase (`module.crm`, `module.hr`).
 *   - `limit.<camelCase>`       — camelCase to match domain terms
 *                                  (`limit.maxUsers`, `limit.maxStorageGB`).
 *   - `admin.<name>`            — short, all-lowercase (`admin.tenants`,
 *                                  `admin.audit`).
 *
 * The regex intentionally accepts letters, digits, underscore, dot,
 * and hyphen so naming stays flexible. Keys MUST start with `module.`,
 * `limit.`, or `admin.` — anything else is rejected so the catalog
 * stays typed end-to-end.
 */
export const ModuleFeatureKeySchema = z.string().regex(/^module\.[a-z][a-z0-9_.-]*$/);

/** Limit keys — "what is the max quota for this resource?". */
export const LimitFeatureKeySchema = z.string().regex(/^limit\.[a-zA-Z][a-zA-Z0-9_.-]*$/);

/** Admin-scoped features (admin-console nav gating). */
export const AdminFeatureKeySchema = z.string().regex(/^admin\.[a-z][a-z0-9_.-]*$/);

/** Any known feature key (module / limit / admin). */
export const FeatureKeySchema = z.union([
  ModuleFeatureKeySchema,
  LimitFeatureKeySchema,
  AdminFeatureKeySchema,
]);

export type ModuleFeatureKey = z.infer<typeof ModuleFeatureKeySchema>;
export type LimitFeatureKey = z.infer<typeof LimitFeatureKeySchema>;
export type AdminFeatureKey = z.infer<typeof AdminFeatureKeySchema>;
export type FeatureKey = z.infer<typeof FeatureKeySchema>;

// ----------------------------------------------------------------------------
// Top-level payload — what `GET /api/entitlements/me` returns.
// ----------------------------------------------------------------------------

/**
 * The full entitlements payload.
 *
 * `plan` and `tenantId` are included so:
 *   - The FE can render plan-aware copy ("Free · Upgrade for CRM") on
 *     the /upgrade page without a second round-trip.
 *   - The dev-mode mock can vary the response by tenant (P3.3 may add
 *     `?tenantId=…` query param so impersonation works without
 *     rewriting the cookie).
 */
export const EntitlementsSchema = z.object({
  /** Tenant the entitlements apply to. super_admin: usually the
   *  currently-impersonated tenant (P1.7) or "—" if global view. */
  tenantId: z.string().nullable(),
  /** Slug of the plan currently assigned to this tenant. */
  plan: AdminPlanSlugSchema,
  /** Human-readable plan label (rendered in the topbar / upgrade page). */
  planLabel: z.string(),
  /** ISO timestamp — useful for "Synced N seconds ago" badges. */
  generatedAt: z.string(),
  /**
   * Boolean feature flags. Missing key === false (see header comment).
   * We intentionally use `z.record(FeatureKeySchema, z.boolean())` —
   * callers get TS autocompletion for the known keys but unknown keys
   * don't crash.
   */
  features: z.record(FeatureKeySchema, z.boolean()),
  /**
   * Numeric limits. Missing key === null (unlimited). `null` is also
   * the "unlimited" sentinel for known keys (e.g. ENTERPRISE
   * `limit.maxUsers = null`).
   */
  limits: z.record(LimitFeatureKeySchema, z.number().int().nonnegative().nullable()),
  /**
   * Current usage for each known limit (used to render "12 / 25 users"
   * progress bars and to gate the route guard BEFORE the user fills
   * the quota — i.e. "you're at 24/25, hard-stop new user invites").
   * Optional because not every key has a current usage counter.
   */
  usage: z.record(LimitFeatureKeySchema, z.number().int().nonnegative().nullable()).optional(),
});

export type Entitlements = z.infer<typeof EntitlementsSchema>;
export type EntitlementFeatures = Entitlements['features'];
export type EntitlementLimits = Entitlements['limits'];
export type EntitlementUsage = NonNullable<Entitlements['usage']>;

// ----------------------------------------------------------------------------
// Upgrade hint — what the FE shows on /upgrade when redirected.
// ----------------------------------------------------------------------------

/**
 * The /upgrade page consumes this to render "X requires the Pro plan".
 * The route guard builds it from the active NAV_ITEM (or from the
 * `<FeatureGuard feature=…>` component on protected pages).
 */
export const UpgradeHintSchema = z.object({
  /** The key that was denied. */
  feature: FeatureKeySchema,
  /** Human-readable feature name (e.g. "CRM"). */
  featureLabel: z.string(),
  /** URL the user tried to access (for the "Back to dashboard" link). */
  from: z.string().optional(),
  /** The plan currently assigned. */
  currentPlan: AdminPlanSlugSchema,
  /** The plan slug that unlocks the feature (best-fit upgrade target). */
  recommendedPlan: AdminPlanSlugSchema,
});

export type UpgradeHint = z.infer<typeof UpgradeHintSchema>;