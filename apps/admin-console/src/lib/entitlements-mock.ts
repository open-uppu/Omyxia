/**
 * Dev-mode fixtures for the entitlements wire format (P3.2).
 *
 * The admin console talks to the BE via `/api/entitlements/me`. While the
 * BE decorator + service that produces those payloads is still being
 * built (P3.1 + P1.x time-series store), the FE needs *something* to
 * render against. This module is that something.
 *
 * Two design rules:
 *
 *   1. **Determinism.** Tests depend on a fixed response. We expose
 *      `buildMockEntitlements({ tenantId, plan })` so the route can
 *      pick a tenant + plan and ALWAYS get the same payload (no Date.now,
 *      no Math.random). The `generatedAt` field is passed in by the
 *      caller — the route stamps it once on first read of the process,
 *      and reuses it for the rest of the process lifetime.
 *
 *   2. **Realism.** The mock must mirror what the BE will eventually
 *      return, including:
 *      - All eight `module.*` keys (email, hr, crm, erp, wms, bi, mas, chat)
 *      - Two `limit.*` keys with realistic caps + usage
 *      - Three `admin.*` keys (tenants, plans, audit)
 *      - Plan tier ordering: FREE < PRO < ENTERPRISE, so the FE can
 *        reason about "does plan X unlock module Y?" without a round-trip.
 *
 * The mock is ONLY used in dev mode (no `ADMIN_API_URL`). In prod the
 * route handler proxies to `${ADMIN_API_URL}/entitlements/me`.
 */

import type {
  Entitlements,
  ModuleFeatureKey,
  LimitFeatureKey,
  AdminFeatureKey,
} from '@omyxia/shared-types';
import { AdminPlanSlugSchema, type AdminPlanSlug } from '@omyxia/shared-types';

// ---------------------------------------------------------------------------
// Plan → feature matrix
//
// This is the single source of truth for "what does plan X unlock?" in
// dev mode. It mirrors the BE catalog (P3.1) and is intentionally
// hard-coded so visual smoke + tests can pin to a known shape.
//
// When P3.1 lands, the BE will own this matrix and the FE will only
// read `features[key]`. Until then, the FE keeps this matrix locally
// so the sidebar/guard wires up correctly against a known fixture.
// ---------------------------------------------------------------------------

type ModuleFlag = Record<ModuleFeatureKey, boolean>;
type LimitCap = Record<LimitFeatureKey, number | null>;
type LimitUsage = Record<LimitFeatureKey, number>;
type AdminFlag = Record<AdminFeatureKey, boolean>;

interface PlanFeatureMatrix {
  /** Modules enabled on this plan. */
  modules: ModuleFlag;
  /** Numeric caps. `null` = unlimited (ENTERPRISE). */
  limits: LimitCap;
  /** Current usage counters (for "12 / 25 users" bars). */
  usage: LimitUsage;
  /** Admin-console nav features enabled. */
  admin: AdminFlag;
  /** Human-readable plan label. */
  label: string;
}

const COMMON_MODULES: ModuleFlag = {
  // Modules all plans get for free (marketing calls it "the basics").
  'module.email': true,
  'module.chat': true,
  'module.hr': false,
  'module.crm': false,
  'module.erp': false,
  'module.wms': false,
  'module.bi': false,
  'module.mas': false,
};

const COMMON_ADMIN: AdminFlag = {
  // Every super_admin sees the Tenants nav item — they can't be an
  // admin if they don't see tenants. Plans / Audit gate below.
  'admin.tenants': true,
  'admin.plans': false,
  'admin.audit': false,
};

const PLAN_MATRIX: Record<AdminPlanSlug, PlanFeatureMatrix> = {
  FREE: {
    modules: { ...COMMON_MODULES },
    limits: {
      'limit.maxUsers': 3,
      'limit.maxStorageGB': 1,
    },
    usage: {
      'limit.maxUsers': 2,
      'limit.maxStorageGB': 0,
    },
    admin: { ...COMMON_ADMIN },
    label: 'Free',
  },
  PRO: {
    modules: {
      ...COMMON_MODULES,
      'module.hr': true,
      'module.crm': true,
      'module.bi': true,
    },
    limits: {
      'limit.maxUsers': 25,
      'limit.maxStorageGB': 100,
    },
    usage: {
      'limit.maxUsers': 12,
      'limit.maxStorageGB': 42,
    },
    admin: {
      ...COMMON_ADMIN,
      'admin.plans': true,
    },
    label: 'Pro — $99/mo',
  },
  ENTERPRISE: {
    modules: {
      'module.email': true,
      'module.chat': true,
      'module.hr': true,
      'module.crm': true,
      'module.erp': true,
      'module.wms': true,
      'module.bi': true,
      'module.mas': true,
    },
    limits: {
      // null = unlimited for ENTERPRISE.
      'limit.maxUsers': null,
      'limit.maxStorageGB': null,
    },
    usage: {
      'limit.maxUsers': 128,
      'limit.maxStorageGB': 2048,
    },
    admin: {
      'admin.tenants': true,
      'admin.plans': true,
      'admin.audit': true,
    },
    label: 'Enterprise',
  },
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface BuildMockEntitlementsInput {
  /** Tenant id, or null for the global super_admin view. */
  tenantId: string | null;
  /** Plan slug — validated against the same enum the wire format uses. */
  plan: AdminPlanSlug;
  /** ISO timestamp — caller-owned so the response is deterministic. */
  generatedAt: string;
}

/**
 * Build a deterministic `Entitlements` payload for dev mode.
 *
 * The returned object matches `EntitlementsSchema` from
 * `@omyxia/shared-types` byte-for-byte — the route handler validates it
 * again before responding, so any drift is caught immediately in tests.
 */
export function buildMockEntitlements(
  input: BuildMockEntitlementsInput
): Entitlements {
  const plan = AdminPlanSlugSchema.parse(input.plan);
  const matrix = PLAN_MATRIX[plan];

  return {
    tenantId: input.tenantId,
    plan,
    planLabel: matrix.label,
    generatedAt: input.generatedAt,
    features: {
      ...matrix.modules,
      ...matrix.admin,
    },
    limits: matrix.limits,
    usage: matrix.usage,
  };
}

/**
 * Read the dev-mode plan override from env, falling back to PRO.
 *
 * The override lets visual smoke flip "tenant X is on FREE" without
 * rewriting the cookie. Default PRO so the demo admin can see most
 * modules in the dashboard.
 *
 * Accepted values:
 *   ADMIN_DEV_PLAN=FREE|PRO|ENTERPRISE
 *
 * Invalid / missing values silently default to PRO — we don't want a
 * typo in a dev-only env var to crash the app.
 */
export function readDevPlanOverride(): AdminPlanSlug {
  const raw = process.env.ADMIN_DEV_PLAN;
  if (!raw) return 'PRO';
  const result = AdminPlanSlugSchema.safeParse(raw);
  return result.success ? result.data : 'PRO';
}

/**
 * Read the dev-mode tenant override from env, defaulting to 't-demo'.
 *
 *   ADMIN_DEV_TENANT=t-abc123
 *
 * Used by the route handler and the visual-smoke script so we can
 * impersonate a specific tenant without touching the JWT.
 */
export function readDevTenantOverride(): string {
  return process.env.ADMIN_DEV_TENANT || 't-demo';
}