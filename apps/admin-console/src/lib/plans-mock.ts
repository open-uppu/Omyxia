/**
 * Dev-mode fixtures for the admin plan & add-on wire format (P2.5).
 *
 * The admin console talks to the BE via `/api/admin/plans` + `/api/admin/add-ons`.
 * While the BE CRUD endpoints are still being built (P1.x admin API time-series
 * expansion), the FE needs *something* to render against. This module is that
 * something.
 *
 * Two design rules (mirrored from `entitlements-mock.ts`):
 *
 *   1. **Determinism.** Tests + visual smoke depend on a fixed response. The
 *      dates use a `FIXED_TS` constant the caller can override; the IDs are
 *      stable strings.
 *
 *   2. **Realism.** The mock must mirror what the BE will eventually return,
 *      matching the P1.2 seed data (Free / Pro / Enterprise tiers + the five
 *      add-ons CRM/ERP/WMS/BI/MAS).
 *
 * The mock is ONLY used in dev mode (no `ADMIN_API_URL`). In prod the
 * route handler proxies to `${ADMIN_API_URL}/admin/plans`.
 */

import type {
  AdminAddOn,
  AdminPlan,
  AdminPlanTier,
  AddOnAppliesTo,
  AddOnSlug,
  CreateAddOnDto,
  CreatePlanDto,
  PlanFeature,
  UpdateAddOnDto,
  UpdatePlanDto,
} from '@omyxia/shared-types';
import {
  AdminAddOnSchema,
  AdminPlanSchema,
  AdminPlanTierSchema,
  AddOnAppliesToSchema,
  AddOnSlugSchema,
  ListAddOnsResponseSchema,
  ListPlansResponseSchema,
  dollarsToCents,
} from '@omyxia/shared-types';

// ---------------------------------------------------------------------------
// Seed timestamps — stable across runs so tests can pin against them.
// ---------------------------------------------------------------------------

export const PLANS_MOCK_FIXED_TS = '2026-07-06T07:00:00.000Z';

/** Used as the `id` for newly-created plans/add-ons in dev mode. */
let mockNonceCounter = 1000;
export function nextMockId(prefix: string): string {
  mockNonceCounter += 1;
  return `${prefix}_mock_${mockNonceCounter}`;
}

// ---------------------------------------------------------------------------
// Static seed — what P1.2 ships. The "entitlementCount" is faked but
// reflects a realistic distribution (Pro is the heavy middle).
// ---------------------------------------------------------------------------

interface FeatureSeed {
  featureKey: PlanFeature['featureKey'];
  featureLabel: string;
  category: PlanFeature['category'];
  enabled: boolean;
  limit?: number | null;
}

const FREE_FEATURES: FeatureSeed[] = [
  { featureKey: 'module.email', featureLabel: 'Email', category: 'module', enabled: true },
  { featureKey: 'module.chat', featureLabel: 'Chat', category: 'module', enabled: true },
  { featureKey: 'module.hr', featureLabel: 'HR', category: 'module', enabled: false },
  { featureKey: 'module.crm', featureLabel: 'CRM', category: 'module', enabled: false },
  { featureKey: 'module.erp', featureLabel: 'ERP', category: 'module', enabled: false },
  { featureKey: 'module.wms', featureLabel: 'WMS', category: 'module', enabled: false },
  { featureKey: 'module.bi', featureLabel: 'BI', category: 'module', enabled: false },
  { featureKey: 'module.mas', featureLabel: 'MAS', category: 'module', enabled: false },
  {
    featureKey: 'limit.maxUsers',
    featureLabel: 'Max users',
    category: 'limit',
    enabled: true,
    limit: 3,
  },
  {
    featureKey: 'limit.maxStorageGB',
    featureLabel: 'Max storage (GB)',
    category: 'limit',
    enabled: true,
    limit: 1,
  },
];

const PRO_FEATURES: FeatureSeed[] = [
  { featureKey: 'module.email', featureLabel: 'Email', category: 'module', enabled: true },
  { featureKey: 'module.chat', featureLabel: 'Chat', category: 'module', enabled: true },
  { featureKey: 'module.hr', featureLabel: 'HR', category: 'module', enabled: true },
  { featureKey: 'module.crm', featureLabel: 'CRM', category: 'module', enabled: false },
  { featureKey: 'module.erp', featureLabel: 'ERP', category: 'module', enabled: false },
  { featureKey: 'module.wms', featureLabel: 'WMS', category: 'module', enabled: false },
  { featureKey: 'module.bi', featureLabel: 'BI', category: 'module', enabled: true },
  { featureKey: 'module.mas', featureLabel: 'MAS', category: 'module', enabled: false },
  {
    featureKey: 'limit.maxUsers',
    featureLabel: 'Max users',
    category: 'limit',
    enabled: true,
    limit: 25,
  },
  {
    featureKey: 'limit.maxStorageGB',
    featureLabel: 'Max storage (GB)',
    category: 'limit',
    enabled: true,
    limit: 100,
  },
];

const ENTERPRISE_FEATURES: FeatureSeed[] = [
  { featureKey: 'module.email', featureLabel: 'Email', category: 'module', enabled: true },
  { featureKey: 'module.chat', featureLabel: 'Chat', category: 'module', enabled: true },
  { featureKey: 'module.hr', featureLabel: 'HR', category: 'module', enabled: true },
  { featureKey: 'module.crm', featureLabel: 'CRM', category: 'module', enabled: true },
  { featureKey: 'module.erp', featureLabel: 'ERP', category: 'module', enabled: true },
  { featureKey: 'module.wms', featureLabel: 'WMS', category: 'module', enabled: true },
  { featureKey: 'module.bi', featureLabel: 'BI', category: 'module', enabled: true },
  { featureKey: 'module.mas', featureLabel: 'MAS', category: 'module', enabled: true },
  {
    featureKey: 'limit.maxUsers',
    featureLabel: 'Max users',
    category: 'limit',
    enabled: true,
    limit: null, // null = unlimited
  },
  {
    featureKey: 'limit.maxStorageGB',
    featureLabel: 'Max storage (GB)',
    category: 'limit',
    enabled: true,
    limit: null, // null = unlimited
  },
];

function expandFeatures(seeds: FeatureSeed[]): PlanFeature[] {
  return seeds.map((seed, idx) => ({
    featureKey: seed.featureKey,
    featureLabel: seed.featureLabel,
    category: seed.category,
    enabled: seed.enabled,
    limit: seed.limit === undefined ? undefined : seed.limit,
    sortOrder: idx,
  }));
}

interface PlanSeed {
  id: string;
  name: string;
  tier: AdminPlanTier;
  priceCents: number;
  description: string;
  isActive: boolean;
  sortOrder: number;
  addOnSlugs: AddOnSlug[];
  features: PlanFeature[];
  entitlementCount: number;
}

const PLAN_SEEDS: PlanSeed[] = [
  {
    id: 'p_free',
    name: 'Free',
    tier: 'FREE',
    priceCents: 0,
    description: 'Starter tier — email + chat only.',
    isActive: true,
    sortOrder: 0,
    addOnSlugs: [],
    features: expandFeatures(FREE_FEATURES),
    entitlementCount: 124,
  },
  {
    id: 'p_pro',
    name: 'Pro',
    tier: 'PRO',
    priceCents: 9900,
    description: 'Email + Chat + HR for growing teams (25 users, 100 GB).',
    isActive: true,
    sortOrder: 1,
    addOnSlugs: ['addon.crm'],
    features: expandFeatures(PRO_FEATURES),
    entitlementCount: 47,
  },
  {
    id: 'p_enterprise',
    name: 'Enterprise',
    tier: 'ENTERPRISE',
    priceCents: 49900,
    description: 'Unlimited users + storage + every module.',
    isActive: true,
    sortOrder: 2,
    addOnSlugs: [
      'addon.crm',
      'addon.erp',
      'addon.wms',
      'addon.bi',
      'addon.mas',
    ],
    features: expandFeatures(ENTERPRISE_FEATURES),
    entitlementCount: 9,
  },
  {
    id: 'p_legacy_full_access',
    name: 'Legacy Full Access',
    tier: 'LEGACY_FULL_ACCESS',
    priceCents: 0,
    description: 'Auto-assigned to v1.0.0 tenants. Expires 2027-12-31.',
    isActive: true,
    sortOrder: 3,
    addOnSlugs: [
      'addon.crm',
      'addon.erp',
      'addon.wms',
      'addon.bi',
      'addon.mas',
    ],
    features: expandFeatures(ENTERPRISE_FEATURES),
    entitlementCount: 318,
  },
];

interface AddOnSeed {
  id: string;
  name: string;
  slug: AddOnSlug;
  priceCents: number;
  description: string;
  appliesTo: AddOnAppliesTo;
  isActive: boolean;
  planCount: number;
}

const ADDON_SEEDS: AddOnSeed[] = [
  {
    id: 'ao_crm',
    name: 'CRM',
    slug: 'addon.crm',
    priceCents: 5000,
    description: 'Customer relationship module (leads, pipeline, contacts).',
    appliesTo: 'ALL',
    isActive: true,
    planCount: 3, // Pro + Enterprise + Legacy Full Access
  },
  {
    id: 'ao_erp',
    name: 'ERP',
    slug: 'addon.erp',
    priceCents: 8000,
    description: 'General ledger, A/R, A/P, fixed assets.',
    appliesTo: 'PRO',
    isActive: true,
    planCount: 2, // Enterprise + Legacy Full Access
  },
  {
    id: 'ao_wms',
    name: 'WMS',
    slug: 'addon.wms',
    priceCents: 6000,
    description: 'Warehouse management (bins, lots, pick lists).',
    appliesTo: 'PRO',
    isActive: true,
    planCount: 2, // Enterprise + Legacy Full Access
  },
  {
    id: 'ao_bi',
    name: 'BI',
    slug: 'addon.bi',
    priceCents: 4000,
    description: 'Custom KPI dashboards + scheduled reports.',
    appliesTo: 'ALL',
    isActive: true,
    planCount: 3, // Pro + Enterprise + Legacy Full Access
  },
  {
    id: 'ao_mas',
    name: 'MAS',
    slug: 'addon.mas',
    priceCents: 4500,
    description: 'Manufacturing execution + operations scheduling.',
    appliesTo: 'ENTERPRISE',
    isActive: true,
    planCount: 2, // Enterprise + Legacy Full Access
  },
];

// ---------------------------------------------------------------------------
// In-memory store — shared across route invocations within the same Node
// worker. Mutations from PATCH/POST/DELETE route handlers update the store
// so subsequent GETs reflect the change. The store is NOT persisted between
// process restarts (intentional — dev fixtures only).
// ---------------------------------------------------------------------------

class PlansMockStore {
  private plans: AdminPlan[];
  private addOns: AdminAddOn[];

  constructor() {
    this.plans = PLAN_SEEDS.map((seed) => seedToPlan(seed));
    this.addOns = ADDON_SEEDS.map((seed) => seedToAddOn(seed));
  }

  listPlans(generatedAt: string) {
    return ListPlansResponseSchema.parse({
      plans: [...this.plans].sort((a, b) => a.sortOrder - b.sortOrder),
      addOns: [...this.addOns].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      generatedAt,
    });
  }

  listAddOns(generatedAt: string) {
    return ListAddOnsResponseSchema.parse({
      addOns: [...this.addOns].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      generatedAt,
    });
  }

  createPlan(dto: CreatePlanDto, generatedAt: string): AdminPlan {
    const id = nextMockId('p');
    const nextOrder = this.plans.length
      ? Math.max(...this.plans.map((p) => p.sortOrder)) + 1
      : 0;
    const plan: AdminPlan = AdminPlanSchema.parse({
      id,
      name: dto.name,
      tier: dto.tier,
      priceCents: dto.priceCents,
      priceDollars: centsToDollarsString(dto.priceCents),
      description: dto.description ?? null,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? nextOrder,
      addOnSlugs: dto.addOnSlugs ?? [],
      features: (dto.features ?? []).map((f, idx) => ({
        featureKey: f.featureKey,
        featureLabel: f.featureLabel,
        category: f.category,
        enabled: f.enabled,
        limit: f.limit === undefined ? undefined : f.limit,
        sortOrder: f.sortOrder ?? idx,
      })),
      entitlementCount: 0,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    this.plans = [...this.plans, plan];
    // Plan now includes an add-on → bump that add-on's planCount.
    for (const slug of plan.addOnSlugs) {
      const idx = this.addOns.findIndex((a) => a.slug === slug);
      if (idx !== -1) {
        const existing = this.addOns[idx]!;
        this.addOns[idx] = {
          ...existing,
          planCount: existing.planCount + 1,
          updatedAt: generatedAt,
        };
      }
    }
    return plan;
  }

  updatePlan(
    id: string,
    dto: UpdatePlanDto,
    generatedAt: string
  ): AdminPlan | null {
    const idx = this.plans.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const before = this.plans[idx]!;
    const beforeSlugs = new Set(before.addOnSlugs);
    const after: AdminPlan = AdminPlanSchema.parse({
      ...before,
      name: dto.name ?? before.name,
      tier: dto.tier ?? before.tier,
      priceCents: dto.priceCents ?? before.priceCents,
      priceDollars:
        dto.priceCents === undefined
          ? before.priceDollars
          : centsToDollarsString(dto.priceCents),
      description:
        dto.description === undefined
          ? before.description
          : dto.description,
      isActive: dto.isActive ?? before.isActive,
      sortOrder: dto.sortOrder ?? before.sortOrder,
      addOnSlugs: dto.addOnSlugs ?? before.addOnSlugs,
      features:
        dto.features === undefined
          ? before.features
          : dto.features.map((f, i) => ({
              featureKey: f.featureKey,
              featureLabel: f.featureLabel,
              category: f.category,
              enabled: f.enabled,
              limit: f.limit === undefined ? undefined : f.limit,
              sortOrder: f.sortOrder ?? i,
            })),
      updatedAt: generatedAt,
    });
    this.plans = [...this.plans];
    this.plans[idx] = after;

    // Recompute add-on planCount whenever addOnSlugs changes.
    const afterSlugs = new Set(after.addOnSlugs);
    const slugsChanged =
      beforeSlugs.size !== afterSlugs.size ||
      [...beforeSlugs].some((s) => !afterSlugs.has(s));
    if (slugsChanged) {
      const counts = new Map<AddOnSlug, number>();
      for (const p of this.plans) {
        for (const slug of p.addOnSlugs) {
          counts.set(slug, (counts.get(slug) ?? 0) + 1);
        }
      }
      this.addOns = this.addOns.map((a) => ({
        ...a,
        planCount: counts.get(a.slug) ?? 0,
        updatedAt: generatedAt,
      }));
    }
    return after;
  }

  reorderPlanFeatures(
    id: string,
    orderedFeatureKeys: readonly string[],
    generatedAt: string
  ): AdminPlan | null {
    const idx = this.plans.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const before = this.plans[idx]!;
    const keyOrder = new Map(
      orderedFeatureKeys.map((k, i) => [k, i] as const)
    );
    const features = before.features
      .map((f) => ({
        ...f,
        sortOrder: keyOrder.get(f.featureKey) ?? f.sortOrder,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const after: AdminPlan = AdminPlanSchema.parse({
      ...before,
      features,
      updatedAt: generatedAt,
    });
    this.plans = [...this.plans];
    this.plans[idx] = after;
    return after;
  }

  deletePlan(id: string): boolean {
    const idx = this.plans.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const removed = this.plans[idx]!;
    this.plans = this.plans.filter((_, i) => i !== idx);
    // Remove dangling add-on planCount.
    const counts = new Map<AddOnSlug, number>();
    for (const p of this.plans) {
      for (const slug of p.addOnSlugs) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    this.addOns = this.addOns.map((a) =>
      removed.addOnSlugs.includes(a.slug)
        ? { ...a, planCount: counts.get(a.slug) ?? 0, updatedAt: PLANS_MOCK_FIXED_TS }
        : a
    );
    return true;
  }

  createAddOn(dto: CreateAddOnDto, generatedAt: string): AdminAddOn {
    const slug =
      dto.slug ??
      (AddOnSlugSchema.parse(
        `addon.${slugify(dto.name) || nextMockId('x').replace(/_mock_/, '')}`
      ) as AddOnSlug);
    const addOn: AdminAddOn = AdminAddOnSchema.parse({
      id: nextMockId('ao'),
      name: dto.name,
      slug,
      priceCents: dto.priceCents,
      priceDollars: centsToDollarsString(dto.priceCents),
      description: dto.description ?? null,
      appliesTo: dto.appliesTo ?? 'ALL',
      isActive: dto.isActive ?? true,
      planCount: 0,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    this.addOns = [...this.addOns, addOn];
    return addOn;
  }

  updateAddOn(
    id: string,
    dto: UpdateAddOnDto,
    generatedAt: string
  ): AdminAddOn | null {
    const idx = this.addOns.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const before = this.addOns[idx]!;
    const after: AdminAddOn = AdminAddOnSchema.parse({
      ...before,
      name: dto.name ?? before.name,
      slug: dto.slug ?? before.slug,
      priceCents: dto.priceCents ?? before.priceCents,
      priceDollars:
        dto.priceCents === undefined
          ? before.priceDollars
          : centsToDollarsString(dto.priceCents),
      description:
        dto.description === undefined
          ? before.description
          : dto.description,
      appliesTo: dto.appliesTo ?? before.appliesTo,
      isActive: dto.isActive ?? before.isActive,
      updatedAt: generatedAt,
    });
    this.addOns = [...this.addOns];
    this.addOns[idx] = after;
    return after;
  }

  deleteAddOn(id: string): boolean {
    const idx = this.addOns.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    const removed = this.addOns[idx]!;
    this.addOns = this.addOns.filter((_, i) => i !== idx);
    // Plans that previously referenced the add-on lose it.
    this.plans = this.plans.map((p) =>
      p.addOnSlugs.includes(removed.slug)
        ? {
            ...p,
            addOnSlugs: p.addOnSlugs.filter((s) => s !== removed.slug),
            updatedAt: PLANS_MOCK_FIXED_TS,
          }
        : p
    );
    return true;
  }
}

function seedToPlan(seed: PlanSeed): AdminPlan {
  return {
    id: seed.id,
    name: seed.name,
    tier: seed.tier,
    priceCents: seed.priceCents,
    priceDollars: centsToDollarsString(seed.priceCents),
    description: seed.description,
    isActive: seed.isActive,
    sortOrder: seed.sortOrder,
    addOnSlugs: seed.addOnSlugs,
    features: seed.features,
    entitlementCount: seed.entitlementCount,
    createdAt: PLANS_MOCK_FIXED_TS,
    updatedAt: PLANS_MOCK_FIXED_TS,
  };
}

function seedToAddOn(seed: AddOnSeed): AdminAddOn {
  return {
    id: seed.id,
    name: seed.name,
    slug: seed.slug,
    priceCents: seed.priceCents,
    priceDollars: centsToDollarsString(seed.priceCents),
    description: seed.description,
    appliesTo: seed.appliesTo,
    isActive: seed.isActive,
    planCount: seed.planCount,
    createdAt: PLANS_MOCK_FIXED_TS,
    updatedAt: PLANS_MOCK_FIXED_TS,
  };
}

function centsToDollarsString(cents: number): string {
  // Stable 2-decimal string. Avoids Intl — keeps tests deterministic
  // across Node versions / LCIDs.
  const dollars = cents / 100;
  return dollars.toFixed(2);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Singleton instance — cached across requests so dev mutations stick.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __OMYXIA_PLANS_MOCK_STORE__: PlansMockStore | undefined;
}

function getStore(): PlansMockStore {
  if (!globalThis.__OMYXIA_PLANS_MOCK_STORE__) {
    globalThis.__OMYXIA_PLANS_MOCK_STORE__ = new PlansMockStore();
  }
  return globalThis.__OMYXIA_PLANS_MOCK_STORE__;
}

/** Reset the store — used by tests to start from a clean slate. */
export function resetPlansMockStore(): void {
  globalThis.__OMYXIA_PLANS_MOCK_STORE__ = new PlansMockStore();
  mockNonceCounter = 1000;
}

/** Read the store — called by route handlers in dev mode. */
export function readPlansMockStore(): PlansMockStore {
  return getStore();
}

// ---------------------------------------------------------------------------
// Convenience wrappers — kept thin so route handlers stay readable.
// ---------------------------------------------------------------------------

export function buildMockPlansList(generatedAt: string = PLANS_MOCK_FIXED_TS) {
  return getStore().listPlans(generatedAt);
}

export function buildMockAddOnsList(generatedAt: string = PLANS_MOCK_FIXED_TS) {
  return getStore().listAddOns(generatedAt);
}

export function createMockPlan(dto: CreatePlanDto, generatedAt: string = PLANS_MOCK_FIXED_TS) {
  return getStore().createPlan(dto, generatedAt);
}

export function updateMockPlan(
  id: string,
  dto: UpdatePlanDto,
  generatedAt: string = PLANS_MOCK_FIXED_TS
) {
  return getStore().updatePlan(id, dto, generatedAt);
}

export function reorderMockPlanFeatures(
  id: string,
  orderedFeatureKeys: readonly string[],
  generatedAt: string = PLANS_MOCK_FIXED_TS
) {
  return getStore().reorderPlanFeatures(id, orderedFeatureKeys, generatedAt);
}

export function deleteMockPlan(id: string) {
  return getStore().deletePlan(id);
}

export function createMockAddOn(
  dto: CreateAddOnDto,
  generatedAt: string = PLANS_MOCK_FIXED_TS
) {
  return getStore().createAddOn(dto, generatedAt);
}

export function updateMockAddOn(
  id: string,
  dto: UpdateAddOnDto,
  generatedAt: string = PLANS_MOCK_FIXED_TS
) {
  return getStore().updateAddOn(id, dto, generatedAt);
}

export function deleteMockAddOn(id: string) {
  return getStore().deleteAddOn(id);
}

/** Type guards re-exported for tests + route handlers. */
export const PlansMock = {
  AdminPlanTierSchema,
  AddOnAppliesToSchema,
  AddOnSlugSchema,
};
// ensure helpers are referenced (avoid unused-import TS errors)
void dollarsToCents;
