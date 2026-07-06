// @vitest-environment node
//
// Unit tests for the admin-plan wire format (P2.5).
//
// We assert:
//   1. The enum validators accept only the canonical DB enums.
//   2. Plan + AddOn shapes round-trip through `parse()` without drift.
//   3. The `limit` field is optional for `module.*` keys; required
//      cap semantics: null = unlimited, integer = cap.
//   4. `formatPriceCents` is deterministic (no LOCALE / Date drift).
//   5. `dollarsToCents` + `centsToDollars` round-trip within ±0.005.
//   6. The DTO shapes reject obvious garbage (negative price,
//      featureKey with leading digit, etc.).

import { describe, expect, it } from 'vitest';
import {
  AdminPlanSchema,
  AdminAddOnSchema,
  PlanFeatureSchema,
  CreatePlanDtoSchema,
  UpdatePlanDtoSchema,
  ReorderPlanFeaturesDtoSchema,
  CreateAddOnDtoSchema,
  UpdateAddOnDtoSchema,
  ListPlansResponseSchema,
  ListAddOnsResponseSchema,
  centsToDollars,
  dollarsToCents,
  formatPriceCents,
  type AdminPlan,
  type AdminAddOn,
} from './admin-plans';

const FIXED_PLAN: AdminPlan = {
  id: 'p_pro',
  name: 'Pro',
  tier: 'PRO',
  priceCents: 9900,
  priceDollars: '99.00',
  description: 'Email + Chat + HR for growing teams.',
  isActive: true,
  sortOrder: 2,
  addOnSlugs: ['addon.crm'],
  features: [
    {
      featureKey: 'module.email',
      featureLabel: 'Email',
      category: 'module',
      enabled: true,
      sortOrder: 0,
    },
    {
      featureKey: 'limit.maxUsers',
      featureLabel: 'Max users',
      category: 'limit',
      enabled: true,
      limit: 25,
      sortOrder: 1,
    },
  ],
  entitlementCount: 47,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

const FIXED_ADDON: AdminAddOn = {
  id: 'ao_crm',
  name: 'CRM',
  slug: 'addon.crm',
  priceCents: 5000,
  priceDollars: '50.00',
  description: 'Customer relationship module.',
  appliesTo: 'ALL',
  isActive: true,
  planCount: 1,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

describe('AdminPlanSchema', () => {
  it('round-trips a known plan payload', () => {
    const parsed = AdminPlanSchema.parse(FIXED_PLAN);
    expect(parsed).toEqual(FIXED_PLAN);
  });

  it('rejects negative priceCents', () => {
    const result = AdminPlanSchema.safeParse({ ...FIXED_PLAN, priceCents: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts a plan with no features', () => {
    const result = AdminPlanSchema.safeParse({ ...FIXED_PLAN, features: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a plan tier outside the enum', () => {
    const result = AdminPlanSchema.safeParse({ ...FIXED_PLAN, tier: 'GOLD' });
    expect(result.success).toBe(false);
  });

  it('accepts LEGACY_FULL_ACCESS tier for migration seeding', () => {
    const result = AdminPlanSchema.safeParse({
      ...FIXED_PLAN,
      tier: 'LEGACY_FULL_ACCESS',
    });
    expect(result.success).toBe(true);
  });
});

describe('PlanFeatureSchema', () => {
  it('limit.* keys allow null (unlimited)', () => {
    const result = PlanFeatureSchema.safeParse({
      featureKey: 'limit.maxStorageGB',
      featureLabel: 'Max storage (GB)',
      category: 'limit',
      enabled: true,
      limit: null,
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative limits', () => {
    const result = PlanFeatureSchema.safeParse({
      featureKey: 'limit.maxUsers',
      featureLabel: 'Max users',
      category: 'limit',
      enabled: true,
      limit: -1,
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects featureKey with leading digit', () => {
    const result = PlanFeatureSchema.safeParse({
      featureKey: '1module.email',
      featureLabel: 'Email',
      category: 'module',
      enabled: true,
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects featureKey with whitespace', () => {
    const result = PlanFeatureSchema.safeParse({
      featureKey: 'module email',
      featureLabel: 'Email',
      category: 'module',
      enabled: true,
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('AdminAddOnSchema', () => {
  it('round-trips a known add-on payload', () => {
    const parsed = AdminAddOnSchema.parse(FIXED_ADDON);
    expect(parsed).toEqual(FIXED_ADDON);
  });

  it('rejects ADD-ON slug without addon. prefix', () => {
    const result = AdminAddOnSchema.safeParse({ ...FIXED_ADDON, slug: 'crm' });
    expect(result.success).toBe(false);
  });

  it('all four appliesTo values are accepted', () => {
    for (const appliesTo of ['ALL', 'FREE', 'PRO', 'ENTERPRISE'] as const) {
      const result = AdminAddOnSchema.safeParse({ ...FIXED_ADDON, appliesTo });
      expect(result.success).toBe(true);
    }
  });
});

describe('DTO schemas', () => {
  it('CreatePlanDtoSchema fills defaults', () => {
    const parsed = CreatePlanDtoSchema.parse({
      name: 'Starter',
      tier: 'FREE',
      priceCents: 0,
    });
    expect(parsed.isActive).toBe(true);
    expect(parsed.sortOrder).toBe(0);
    expect(parsed.addOnSlugs).toEqual([]);
    expect(parsed.features).toEqual([]);
  });

  it('UpdatePlanDtoSchema allows partial updates', () => {
    const result = UpdatePlanDtoSchema.safeParse({ priceCents: 4900 });
    expect(result.success).toBe(true);
  });

  it('ReorderPlanFeaturesDtoSchema enforces non-empty ordered list', () => {
    expect(
      ReorderPlanFeaturesDtoSchema.safeParse({ orderedFeatureKeys: [] }).success
    ).toBe(false);
    expect(
      ReorderPlanFeaturesDtoSchema.safeParse({
        orderedFeatureKeys: ['module.email'],
      }).success
    ).toBe(true);
  });

  it('CreateAddOnDtoSchema fills defaults + is optional on slug', () => {
    const parsed = CreateAddOnDtoSchema.parse({
      name: 'WMS',
      priceCents: 6000,
    });
    expect(parsed.appliesTo).toBe('ALL');
    expect(parsed.isActive).toBe(true);
    expect(parsed.slug).toBeUndefined();
  });

  it('UpdateAddOnDtoSchema allows partial updates', () => {
    const result = UpdateAddOnDtoSchema.safeParse({ priceCents: 1500 });
    expect(result.success).toBe(true);
  });
});

describe('List payload schemas', () => {
  it('ListPlansResponseSchema bundles plans + add-ons', () => {
    const parsed = ListPlansResponseSchema.parse({
      plans: [FIXED_PLAN],
      addOns: [FIXED_ADDON],
      generatedAt: '2026-07-06T00:00:00.000Z',
    });
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.addOns).toHaveLength(1);
    expect(parsed.plans[0]?.id).toBe('p_pro');
  });

  it('ListAddOnsResponseSchema accepts an empty array', () => {
    const parsed = ListAddOnsResponseSchema.parse({
      addOns: [],
      generatedAt: '2026-07-06T00:00:00.000Z',
    });
    expect(parsed.addOns).toEqual([]);
  });
});

describe('Money helpers', () => {
  it('dollarsToCents rounds half-up', () => {
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(0.01)).toBe(1);
    expect(dollarsToCents(99.99)).toBe(9999);
    expect(dollarsToCents(99.995)).toBe(10000); // half-up
  });

  it('dollarsToCents floors negatives to 0', () => {
    expect(dollarsToCents(-10)).toBe(0);
    expect(dollarsToCents(NaN)).toBe(0);
  });

  it('centsToDollars inverts dollarsToCents within ±0.005', () => {
    for (const cents of [0, 1, 99, 100, 9900, 123456]) {
      const dollars = centsToDollars(cents);
      const roundTrip = dollarsToCents(dollars);
      expect(Math.abs(roundTrip - cents)).toBeLessThanOrEqual(1);
    }
  });

  it('formatPriceCents is deterministic + locale-free for USD', () => {
    expect(formatPriceCents(0)).toBe('$0.00');
    expect(formatPriceCents(9900)).toBe('$99.00');
    expect(formatPriceCents(1)).toBe('$0.01');
    expect(formatPriceCents(9900, 'EUR')).toBe('99.00');
  });
});
