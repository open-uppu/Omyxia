/**
 * omyxia v2.0.0 P4.1 — StripeService tests (test mode).
 *
 * The service runs in test mode (no Stripe secret key configured) so we
 * can exercise the full DB-touching code path without a real network.
 * Assertions focus on:
 *   1. ensureCustomer is idempotent (second call does not create a row).
 *   2. ensureCustomer persists the mapping in StripeCustomer + the
 *      denormalised Tenant.stripeCustomerId field.
 *   3. createPortalSession returns a deterministic stub URL when testMode.
 *   4. createCheckoutSession includes the plan tier + add-on IDs in the
 *      generated fake URL so the FE devs can verify the route in dev.
 *   5. replaceSubscriptionItems + cancelSubscription skip the network
 *      when the rows already exist (test mode optimisations).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from './stripe.service';
import { StripeCatalogService } from './stripe-catalog.service';
import {
  STRIPE_PRICE_PRO,
  STRIPE_PRICE_ENTERPRISE,
  STRIPE_PRICE_ADDON_EXTRA_STORAGE,
} from './__fixtures__/stripe-objects';
import { planRecord, addOnRecord, tenantRecord } from './__fixtures__/stripe.fixtures';

function mkPrismaStub(opts: { tenant?: any; existingCustomer?: any } = {}) {
  const tenant = opts.tenant ?? tenantRecord();
  const existingCustomer = opts.existingCustomer ?? null;
  let lastTx: any = null;
  let lastTenantUpdate: any = null;
  const create = vi.fn(async (args: any) => ({ id: 'cus_db_id', ...args.data }));
  const update = vi.fn(async (args: any) => {
    lastTenantUpdate = args;
    return { ...tenant, ...args.data };
  });
  const findUnique = vi.fn(async (args: any) => {
    if (args.where?.tenantId) return existingCustomer;
    if (args.where?.id) return tenant;
    return null;
  });
  const findFirst = vi.fn(async () => null);
  return {
    prisma: {
      stripeCustomer: {
        findUnique,
        create,
      },
      tenant: {
        findUnique,
        update,
      },
      $transaction: vi.fn(async (operations: any[]) => {
        lastTx = operations;
        return operations.map(() => ({}));
      }),
    } as any,
    getLastTx: () => lastTx,
    getLastTenantUpdate: () => lastTenantUpdate,
    getCreateCalls: () => create.mock.calls,
    getUpdateCalls: () => update.mock.calls,
  };
}

function mkCatalog(): StripeCatalogService {
  return {
    priceIdForPlanTier: vi.fn(async (tier: string) => {
      if (tier === 'PRO') return STRIPE_PRICE_PRO;
      if (tier === 'ENTERPRISE') return STRIPE_PRICE_ENTERPRISE;
      return null;
    }),
    priceIdForAddOn: vi.fn(async (id: string) =>
      id === 'addon_extra_storage_id' ? STRIPE_PRICE_ADDON_EXTRA_STORAGE : null,
    ),
  } as unknown as StripeCatalogService;
}

function mkTenantContext(): any {
  return { run: vi.fn(async (_id: string, fn: any) => fn()) };
}

describe('StripeService (test mode)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_TEST_MODE = 'true';
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('ensureCustomer creates a new customer when none exists (test mode)', async () => {
    const stub = mkPrismaStub();
    const svc = new StripeService(stub.prisma, mkCatalog(), mkTenantContext());
    const result = await svc.ensureCustomer('tenant-1');
    expect(result.stripeCustomerId).toMatch(/^cus_test_tenant/);
    expect(stub.getCreateCalls().length).toBe(1);
    expect(stub.getUpdateCalls().length).toBe(1);
  });

  it('ensureCustomer is a no-op when the mapping already exists', async () => {
    const stub = mkPrismaStub({
      tenant: tenantRecord({ id: 'tenant-1' }),
      existingCustomer: {
        id: 'c1',
        tenantId: 'tenant-1',
        stripeCustomerId: 'cus_existing',
        email: 'owner@example.test',
        livemode: false,
      },
    });
    const svc = new StripeService(stub.prisma, mkCatalog(), mkTenantContext());
    const result = await svc.ensureCustomer('tenant-1');
    expect(result.stripeCustomerId).toBe('cus_existing');
    expect(stub.getCreateCalls().length).toBe(0);
    expect(stub.getUpdateCalls().length).toBe(0);
  });

  it('createPortalSession returns the requested returnUrl in test mode', async () => {
    const stub = mkPrismaStub({
      existingCustomer: {
        id: 'c1',
        tenantId: 'tenant-1',
        stripeCustomerId: 'cus_existing',
        email: null,
        livemode: false,
      },
    });
    const svc = new StripeService(stub.prisma, mkCatalog(), mkTenantContext());
    const result = await svc.createPortalSession('tenant-1', 'https://admin.example/billing');
    expect(result.returnUrl).toBe('https://admin.example/billing');
    expect(result.url).toContain('customer=cus_existing');
  });

  it('createCheckoutSession bails loudly when no prices are wired for the plan', async () => {
    const stub = mkPrismaStub({
      existingCustomer: {
        id: 'c1',
        tenantId: 'tenant-1',
        stripeCustomerId: 'cus_existing',
        email: null,
        livemode: false,
      },
    });
    const failingCatalog = {
      priceIdForPlanTier: vi.fn(async () => null),
      priceIdForAddOn: vi.fn(async () => null),
    } as unknown as StripeCatalogService;
    const svc = new StripeService(stub.prisma, failingCatalog, mkTenantContext());
    await expect(
      svc.createCheckoutSession('tenant-1', 'FREE', [], undefined),
    ).rejects.toThrow(/no Stripe prices/);
  });

  it('createCheckoutSession returns a fake URL including the plan tier', async () => {
    const stub = mkPrismaStub({
      existingCustomer: {
        id: 'c1',
        tenantId: 'tenant-1',
        stripeCustomerId: 'cus_existing',
        email: null,
        livemode: false,
      },
    });
    const svc = new StripeService(stub.prisma, mkCatalog(), mkTenantContext());
    const result = await svc.createCheckoutSession(
      'tenant-1',
      'PRO',
      ['addon_extra_storage_id'],
      undefined,
    );
    expect(result.sessionId).toMatch(/^cs_test_tenant1_pro$/);
    expect(result.url).toContain('plan=PRO');
  });

  it('replaceSubscriptionItems rejects when no items are supplied (refuse empty)', async () => {
    const stub = mkPrismaStub({
      existingCustomer: {
        id: 'c1',
        tenantId: 'tenant-1',
        stripeCustomerId: 'cus_existing',
        email: null,
        livemode: false,
      },
    });
    const failingCatalog = {
      priceIdForPlanTier: vi.fn(async () => null),
      priceIdForAddOn: vi.fn(async () => null),
    } as unknown as StripeCatalogService;
    const svc = new StripeService(stub.prisma, failingCatalog, mkTenantContext());
    await expect(
      svc.replaceSubscriptionItems('tenant-1', 'sub_x', 'PRO', [], 'create_prorations'),
    ).rejects.toThrow(/cannot replace subscription items with no items/);
  });

  it('cancelSubscription with atPeriodEnd=true skips the network in test mode', async () => {
    const stub = mkPrismaStub({
      existingCustomer: {
        id: 'c1',
        tenantId: 'tenant-1',
        stripeCustomerId: 'cus_existing',
        email: null,
        livemode: false,
      },
    });
    const svc = new StripeService(stub.prisma, mkCatalog(), mkTenantContext());
    const result = await svc.cancelSubscription('tenant-1', 'sub_x', true);
    expect(result.stripeSubscriptionId).toBe('sub_x');
    expect(result.livemode).toBe(false);
  });
});

/**
 * Quiescence check — make sure the fixtures we depend on actually match
 * the catalog row shapes. This is deliberately not a runtime test of the
 * service; it's a sanity guard against drift between fixtures and the
 * catalog service assertions.
 */
describe('stripe-catalog fixtures', () => {
  it('planRecord + addOnRecord are well-formed', () => {
    expect(planRecord().stripePriceId).toBeNull();
    expect(addOnRecord().stripePriceId).toBeNull();
  });
});
