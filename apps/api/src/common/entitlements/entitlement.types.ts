/**
 * Runtime types for the entitlements service.
 *
 * These types describe the in-memory shape the `@RequiresFeature` guard
 * consumes. The on-the-wire shape (returned by
 * `GET /api/admin/entitlements/:tenantId` or `GET /api/entitlements/me`)
 * lives in `packages/shared-types/src/admin-entitlements.ts` so the FE
 * can import the same zod schemas.
 *
 * The guard never reaches the wire endpoint directly — it reads
 * `TenantEntitlements` from `EntitlementsService.forTenant(tenantId)`
 * (Redis-cached), so this shape is the only contract the BE cares about.
 */
import type { PlanTier } from '@prisma/client';
import type { FeatureKey } from './feature-catalog';

/**
 * Decoded entitlement payload for a single tenant.
 *
 * Sourced from the join of `TenantEntitlement` → `Plan` + `PlanFeature` +
 * `TenantEntitlementAddOn` → `AddOn`, then cached in Redis under
 * `entitlements:v1:{tenantId}` for `ENTITLEMENT_CACHE_TTL_SECONDS`
 * (default 300).
 */
export interface TenantEntitlements {
  /** Tenant this payload describes. */
  tenantId: string;
  /** Plan slug currently assigned. */
  planTier: PlanTier | 'LEGACY_FULL_ACCESS' | null;
  /** Plan id (UUID from `Plan.id`). Used by the upgrade flow. */
  planId: string | null;
  /** ISO timestamp when this entitlement became effective. */
  effectiveAt: string;
  /** ISO timestamp when this entitlement expires (null = never). */
  expiresAt: string | null;
  /**
   * Map of boolean feature flags.
   *   `true`  — feature unlocked for this tenant.
   *   `false` — explicitly disabled (or absent from the plan matrix).
   *
   * Unknown keys default to `false` (fail-closed) on the guard side.
   */
  features: Record<string, boolean>;
  /**
   * Map of numeric caps for `limit.*` features.
   *   `null` means unlimited.
   */
  limits: Record<string, number | null>;
  /**
   * Slugs of add-ons currently attached (see `TenantEntitlementAddOn`).
   */
  addOns: string[];
  /** ISO timestamp this payload was materialised. */
  generatedAt: string;
}

/**
 * Options accepted by `@RequiresFeature()`.
 *
 *   @RequiresFeature('module.crm')                                  — boolean flag.
 *   @RequiresFeature('module.crm', { soft: true })                 — boolean flag, soft-fail.
 *   @RequiresFeature('limit.maxEmployees', { max: 25 })            — numeric cap: current must allow at least 25.
 *   @RequiresFeature('limit.maxEmployees', { max: 25, soft: true }) — numeric cap, soft-fail.
 *
 * `soft` = the guard logs the failure but lets the request through
 * (useful for gradual rollouts or shadow mode). Defaults to `false`.
 */
export interface RequiresFeatureOptions {
  /** Minimum required value for `limit.*` features. */
  max?: number;
  /** If true, log the violation but allow the request to proceed. */
  soft?: boolean;
  /**
   * Where the user gets redirected on denial.
   * Defaults to `buildUpgradeUrl(...)`.
   */
  upgradeHref?: string;
}

/**
 * The shape `FeatureGateGuard` produces when the request is denied.
 * Mirrored on the FE in `UpgradeHintSchema`.
 */
export interface FeatureForbiddenPayload {
  /** Stable error code — drives the FE upgrade modal. */
  code: 'FEATURE_NOT_INCLUDED' | 'FEATURE_LIMIT_EXCEEDED';
  /** Human message. */
  message: string;
  /** The feature key that was denied. */
  feature: FeatureKey;
  /** For `limit.*` features: the cap the tenant has. */
  currentLimit?: number | null;
  /** For `limit.*` features: the requested value (i.e. `opts.max`). */
  requiredMax?: number | null;
  /** The tenant the check ran against (for audit / log enrichment). */
  tenantId: string;
  /** URL to send the user — FE navigates here on receipt. */
  upgradeUrl: string;
  /** Plan currently assigned. */
  currentPlan: string;
  /** Plan slug that first unlocks this feature. */
  recommendedPlan: 'PRO' | 'ENTERPRISE' | null;
}
