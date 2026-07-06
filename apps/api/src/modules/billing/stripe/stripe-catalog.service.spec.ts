/**
 * omyxia v2.0.0 P4.1 — StripeCatalogService tests.
 *
 * Two flavours of lookup are covered:
 *   1. Database-first — when the catalog row has a stripePriceId set.
 *   2. Env fallback — when the catalog row is unmapped, we fall back to
 *      STRIPE_PRICE_PRO / STRIPE_PRICE_ADDON_* env vars.
 *   3. None-found — both lookups miss, the method returns null (so the
 *      caller can decide to surface an error vs no-op).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeCatalogService } from './stripe-catalog.service';
import { planRecord, addOnRecord } from './__fixtures__/stripe.fixtures';

function mkPrismaStub(overrides: any = {}) {
  return {
    plan: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      ...overrides.plan,
    },
    addOn: {
      findUnique: async () => null,
      findMany: async () => [],
      ...overrides.addOn,
    },
  };
}

describe('StripeCatalogService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.STRIPE_PRICE_PRO;
    delete process.env.STRIPE_PRICE_ENTERPRISE;
    delete process.env.STRIPE_PRICE_LEGACY;
    delete process.env.STRIPE_PRICE_FREE;
    delete process.env.STRIPE_PRICE_ADDON_EXTRA_STORAGE;
    delete process.env.STRIPE_PRICE_ADDON_PRIORITY_SUPPORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('prefers the DB stripePriceId over the env fallback', async () => {
    process.env.STRIPE_PRICE_PRO = 'price_env_pro';
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => planRecord({ stripePriceId: 'price_db_pro' }) },
    });
    const service = new StripeCatalogService(prisma as any);
    expect(await service.priceIdForPlan('plan_pro_id')).toBe('price_db_pro');
  });

  it('falls back to env when the DB column is null', async () => {
    process.env.STRIPE_PRICE_PRO = 'price_env_pro';
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => planRecord({ stripePriceId: null, tier: 'PRO' }) },
    });
    const service = new StripeCatalogService(prisma as any);
    expect(await service.priceIdForPlan('plan_pro_id')).toBe('price_env_pro');
  });

  it('returns null when neither DB nor env carries a price', async () => {
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => planRecord({ stripePriceId: null }) },
    });
    const service = new StripeCatalogService(prisma as any);
    expect(await service.priceIdForPlan('plan_pro_id')).toBeNull();
  });

  it('resolves a Stripe price ID back to a Plan row via lookupPrice', async () => {
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => planRecord({ stripePriceId: 'price_db_pro' }) },
      addOn: { findUnique: async () => null },
    });
    const service = new StripeCatalogService(prisma as any);
    const lookup = await service.lookupPrice('price_db_pro');
    expect(lookup).toEqual({ kind: 'PLAN', catalogId: 'plan_pro_id', planTier: 'PRO' });
  });

  it('resolves a Stripe price ID back to an AddOn row when no plan matches', async () => {
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => null },
      addOn: {
        findUnique: async () =>
          addOnRecord({ stripePriceId: 'price_db_addon_storage', slug: 'extra_storage' }),
      },
    });
    const service = new StripeCatalogService(prisma as any);
    const lookup = await service.lookupPrice('price_db_addon_storage');
    expect(lookup).toEqual({ kind: 'ADDON', catalogId: 'addon_extra_storage_id' });
  });

  it('returns null on lookupPrice when no catalog row carries the price id', async () => {
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => null },
      addOn: { findUnique: async () => null },
    });
    const service = new StripeCatalogService(prisma as any);
    expect(await service.lookupPrice('price_unknown')).toBeNull();
  });

  it('builds the env fallback only once per process (snapshot test)', async () => {
    process.env.STRIPE_PRICE_PRO = 'price_env_pro';
    process.env.STRIPE_PRICE_ADDON_EXTRA_STORAGE = 'price_env_addon_storage';
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => planRecord({ stripePriceId: null }) },
      addOn: { findUnique: async () => addOnRecord({ stripePriceId: null }) },
    });
    const service = new StripeCatalogService(prisma as any);
    expect(await service.priceIdForPlanTier('PRO')).toBe('price_env_pro');
    expect(await service.priceIdForAddOn('anything')).toBe('price_env_addon_storage');
  });

  it('treats empty env values as absent', async () => {
    process.env.STRIPE_PRICE_PRO = '';
    const prisma = mkPrismaStub({
      plan: { findUnique: async () => planRecord({ stripePriceId: null }) },
    });
    const service = new StripeCatalogService(prisma as any);
    expect(await service.priceIdForPlanTier('PRO')).toBeNull();
  });
});
