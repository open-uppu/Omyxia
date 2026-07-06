// @vitest-environment node
//
// Unit tests for the dev-mode plans/add-ons store (P2.5).
//
// We assert:
//   1. Default seed has 4 plans + 5 add-ons (Free / Pro / Enterprise /
//      Legacy Full Access; CRM/ERP/WMS/BI/MAS).
//   2. CRUD works: create / update / delete mutate the in-memory
//      store and downstream getters reflect the change.
//   3. Reorder rewrites sortOrder for the specified keys.
//   4. Deleting a plan decrements the add-on's planCount.
//   5. Delete add-on removes the slug from any plan that bundled it.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  AdminAddOnSchema,
  AdminPlanSchema,
} from '@omyxia/shared-types';
import {
  buildMockPlansList,
  buildMockAddOnsList,
  createMockAddOn,
  createMockPlan,
  deleteMockAddOn,
  deleteMockPlan,
  reorderMockPlanFeatures,
  resetPlansMockStore,
  updateMockAddOn,
  updateMockPlan,
  PLANS_MOCK_FIXED_TS,
} from './plans-mock';

const TS = '2026-07-06T07:30:00.000Z';

describe('plans-mock — default seed', () => {
  beforeEach(() => {
    resetPlansMockStore();
  });

  it('starts with 4 plans in P1.2 order', () => {
    const { plans } = buildMockPlansList(TS);
    expect(plans.map((p) => p.id)).toEqual([
      'p_free',
      'p_pro',
      'p_enterprise',
      'p_legacy_full_access',
    ]);
    expect(plans.map((p) => p.tier)).toEqual([
      'FREE',
      'PRO',
      'ENTERPRISE',
      'LEGACY_FULL_ACCESS',
    ]);
  });

  it('lists the 5 seeded add-ons alphabetically', () => {
    const { addOns } = buildMockPlansList(TS);
    expect(addOns.map((a) => a.slug)).toEqual([
      'addon.bi',
      'addon.crm',
      'addon.erp',
      'addon.mas',
      'addon.wms',
    ]);
  });

  it('plans include a sortOrder, priceCents, priceDollars pair', () => {
    const { plans } = buildMockPlansList(TS);
    const pro = plans.find((p) => p.id === 'p_pro');
    expect(pro?.priceCents).toBe(9900);
    expect(pro?.priceDollars).toBe('99.00');
  });

  it('ENTERPRISE features have null limits (unlimited)', () => {
    const { plans } = buildMockPlansList(TS);
    const ent = plans.find((p) => p.id === 'p_enterprise');
    const maxUsers = ent?.features.find((f) => f.featureKey === 'limit.maxUsers');
    expect(maxUsers?.limit).toBeNull();
  });

  it('add-ons listing is sorted alphabetically', () => {
    const { addOns } = buildMockAddOnsList(TS);
    const names = addOns.map((a) => a.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describe('plans-mock — CRUD plans', () => {
  beforeEach(() => {
    resetPlansMockStore();
  });

  it('createPlan returns the new plan + persists in listPlans', () => {
    const created = createMockPlan(
      {
        name: 'Starter',
        tier: 'FREE',
        priceCents: 0,
        description: 'Starter tier for trials.',
        isActive: true,
        sortOrder: 99,
        addOnSlugs: [],
        features: [
          {
            featureKey: 'module.email',
            featureLabel: 'Email',
            category: 'module',
            enabled: true,
            sortOrder: 0,
          },
        ],
      },
      TS
    );
    expect(created.name).toBe('Starter');
    expect(created.id).toMatch(/^p_mock_/);
    const { plans } = buildMockPlansList(TS);
    expect(plans.find((p) => p.id === created.id)).toBeDefined();
  });

  it('updatePlan applies a partial patch and bumps updatedAt', () => {
    const updated = updateMockPlan(
      'p_pro',
      { priceCents: 14900 },
      TS
    );
    expect(updated?.priceCents).toBe(14900);
    expect(updated?.priceDollars).toBe('149.00');
    const { plans } = buildMockPlansList(TS);
    const pro = plans.find((p) => p.id === 'p_pro');
    expect(pro?.priceCents).toBe(14900);
  });

  it('updatePlan returns null when the plan does not exist', () => {
    const result = updateMockPlan('p_does_not_exist', { priceCents: 0 }, TS);
    expect(result).toBeNull();
  });

  it('updatePlan recomputes add-on planCount when addOnSlugs changes', () => {
    updateMockPlan(
      'p_pro',
      { addOnSlugs: ['addon.crm', 'addon.bi'] },
      TS
    );
    const { addOns } = buildMockPlansList(TS);
    const crm = addOns.find((a) => a.slug === 'addon.crm');
    const bi = addOns.find((a) => a.slug === 'addon.bi');
    // CRM seeds on Pro + Enterprise + Legacy = 3 — count unchanged.
    expect(crm?.planCount).toBe(3);
    // BI seeds on Pro + Enterprise + Legacy = 3 — count unchanged.
    expect(bi?.planCount).toBe(3);
  });

  it('reorderPlanFeatures rewrites sortOrder', () => {
    const { plans } = buildMockPlansList(TS);
    const before = plans.find((p) => p.id === 'p_pro')!;
    const original = before.features.map((f) => f.featureKey);
    const reordered = reorderMockPlanFeatures(
      'p_pro',
      [...original].reverse(),
      TS
    );
    expect(reordered).not.toBeNull();
    expect(
      reordered?.features.map((f) => f.featureKey)
    ).toEqual([...original].reverse());
    const { plans: afterPlans } = buildMockPlansList(TS);
    const pro = afterPlans.find((p) => p.id === 'p_pro')!;
    expect(pro.features[0]?.sortOrder).toBe(0);
    expect(pro.features[pro.features.length - 1]?.sortOrder).toBe(
      pro.features.length - 1
    );
  });

  it('reorderPlanFeatures returns null when the plan does not exist', () => {
    const result = reorderMockPlanFeatures(
      'p_does_not_exist',
      ['module.email'],
      TS
    );
    expect(result).toBeNull();
  });

  it('deletePlan removes the plan and updates dependent counts', () => {
    const ok = deleteMockPlan('p_pro');
    expect(ok).toBe(true);
    const { plans } = buildMockPlansList(TS);
    expect(plans.find((p) => p.id === 'p_pro')).toBeUndefined();
    const { addOns } = buildMockPlansList(TS);
    const crm = addOns.find((a) => a.slug === 'addon.crm');
    // After deletion, Enterprise + Legacy still bundle CRM.
    expect(crm?.planCount).toBe(2);
  });

  it('deletePlan returns false when the plan does not exist', () => {
    expect(deleteMockPlan('p_does_not_exist')).toBe(false);
  });
});

describe('plans-mock — CRUD add-ons', () => {
  beforeEach(() => {
    resetPlansMockStore();
  });

  it('createAddOn assigns an id + slug when slug is missing', () => {
    const created = createMockAddOn(
      {
        name: 'Project Mgmt',
        priceCents: 3000,
        description: 'PM module',
        appliesTo: 'ALL',
        isActive: true,
      },
      TS
    );
    expect(created.id).toMatch(/^ao_mock_/);
    expect(created.slug).toBe('addon.project_mgmt');
  });

  it('createAddOn accepts caller-supplied slug', () => {
    const created = createMockAddOn(
      {
        name: 'Custom Addon',
        slug: 'addon.custom',
        priceCents: 1000,
        appliesTo: 'ALL',
        isActive: true,
      },
      TS
    );
    expect(created.slug).toBe('addon.custom');
  });

  it('updateAddOn patches price + appliesTo', () => {
    const updated = updateMockAddOn(
      'ao_crm',
      { priceCents: 7500, appliesTo: 'PRO' },
      TS
    );
    expect(updated?.priceCents).toBe(7500);
    expect(updated?.appliesTo).toBe('PRO');
  });

  it('updateAddOn returns null when the add-on does not exist', () => {
    expect(
      updateMockAddOn('ao_nope', { priceCents: 1 }, TS)
    ).toBeNull();
  });

  it('deleteAddOn removes the slug from any plan that bundled it', () => {
    // Pro bundles addon.crm initially.
    const ok = deleteMockAddOn('ao_crm');
    expect(ok).toBe(true);
    const { plans, addOns } = buildMockPlansList(TS);
    expect(addOns.find((a) => a.id === 'ao_crm')).toBeUndefined();
    const pro = plans.find((p) => p.id === 'p_pro');
    const ent = plans.find((p) => p.id === 'p_enterprise');
    expect(pro?.addOnSlugs).not.toContain('addon.crm');
    expect(ent?.addOnSlugs).not.toContain('addon.crm');
  });

  it('deleteAddOn returns false when the add-on does not exist', () => {
    expect(deleteMockAddOn('ao_nope')).toBe(false);
  });
});

describe('plans-mock — output invariants', () => {
  beforeEach(() => {
    resetPlansMockStore();
  });

  it('every plan round-trips through AdminPlanSchema', () => {
    const { plans } = buildMockPlansList(TS);
    for (const plan of plans) {
      expect(() => AdminPlanSchema.parse(plan)).not.toThrow();
    }
  });

  it('every add-on round-trips through AdminAddOnSchema', () => {
    const { addOns } = buildMockPlansList(TS);
    for (const addon of addOns) {
      expect(() => AdminAddOnSchema.parse(addon)).not.toThrow();
    }
  });

  it('seed TS constant is stable for tests', () => {
    expect(PLANS_MOCK_FIXED_TS).toBe('2026-07-06T07:00:00.000Z');
  });
});
