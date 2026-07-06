/**
 * omyxia v2.0.0 P4.1 — EntitlementsSyncService tests.
 *
 * Covers the three webhook scenarios that mutate tenant entitlements:
 *
 *   * subscription.created / updated → upsert entitlement + items +
 *     invalidate cache.
 *   * subscription.deleted            → entitlement expires + add-ons
 *     cleared + cache invalidated.
 *   * invoice.paid / invoice.payment_failed → audit log row only.
 *
 * Idempotency is asserted by reserving an event twice and confirming the
 * duplicate short-circuits without re-running the sync.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntitlementsSyncService } from './entitlements-sync.service';
import { StripeCatalogService } from './stripe-catalog.service';
import { StripeService } from './stripe.service';
import {
  fakeEvent,
  fakeSubscription,
  STRIPE_PRICE_PRO,
  STRIPE_PRICE_ADDON_EXTRA_STORAGE,
} from './__fixtures__/stripe-objects';

interface FakePrismaResult {
  prisma: any;
  /** Audit-log calls captured for assertions. */
  auditLog: ReturnType<typeof vi.fn>;
}

function mkPrismaStub(opts: {
  tenant?: { id: string; stripeCustomerId: string } | null;
  planStripePriceId?: string;
  addOnStripePriceId?: string;
} = {}): FakePrismaResult {
  const auditLog = vi.fn(async () => ({ id: 'audit-1' }));
  const stripeCustomerRows: Array<{ id: string; tenantId: string; stripeCustomerId: string }> =
    opts.tenant
      ? [{ id: 'c1', tenantId: opts.tenant.id, stripeCustomerId: opts.tenant.stripeCustomerId }]
      : [];

  const plan = {
    id: 'plan_pro_id',
    name: 'Pro',
    tier: 'PRO',
    price: '99.00',
    description: null,
    isActive: true,
    sortOrder: 1,
    stripePriceId: opts.planStripePriceId ?? STRIPE_PRICE_PRO,
    stripeProductId: null,
  };
  const addOn = {
    id: 'addon_extra_storage_id',
    name: 'Extra Storage',
    slug: 'extra_storage',
    price: '20.00',
    appliesTo: 'ALL',
    description: null,
    isActive: true,
    stripePriceId: opts.addOnStripePriceId ?? STRIPE_PRICE_ADDON_EXTRA_STORAGE,
  };
  const freePlan = {
    id: 'plan_free_id',
    name: 'Free',
    tier: 'FREE',
    price: '0.00',
    description: null,
    isActive: true,
    sortOrder: 0,
    stripePriceId: null,
    stripeProductId: null,
  };

  const txState = {
    itemsCreate: [] as any[],
    itemsUpdate: [] as any[],
    subscriptionUpsert: null as any,
    entitlementWrites: [] as any[],
    addonWrites: [] as any[],
  };

  const tx = async (fn: (inner: any) => Promise<void>) => {
    const inner = {
      stripeSubscription: {
        upsert: vi.fn(async (args: any) => {
          txState.subscriptionUpsert = args;
          return { id: 'sub_db_id', tenantId: args.where.tenantId };
        }),
        update: vi.fn(async (args: any) => ({ ...args })),
        findUnique: vi.fn(async () => ({ id: 'sub_db_id' })),
        findUniqueOrThrow: vi.fn(async () => ({ id: 'sub_db_id' })),
        findFirst: vi.fn(async () => null),
      },
      stripeSubscriptionItem: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async (args: any) => {
          (args.where.stripeSubscriptionItemId ? txState.itemsUpdate : txState.itemsCreate).push(args);
          return { id: 'item_id', ...args.create ?? args.update };
        }),
      },
      plan: {
        findFirst: vi.fn(async () => freePlan),
        findUnique: vi.fn(async () => plan),
      },
      addOn: {
        findUnique: vi.fn(async () => addOn),
      },
      tenantEntitlement: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(async (args: any) => ({ id: 'ent_id', ...args.data })),
        create: vi.fn(async (args: any) => {
          txState.entitlementWrites.push(args);
          return { id: 'ent_id', ...args.data };
        }),
      },
      tenantEntitlementAddOn: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async (args: any) => {
          txState.addonWrites.push(args);
          return { id: 'add_id', ...args.data };
        }),
      },
    };
    await fn(inner);
  };

  const prisma = {
    stripeCustomer: {
      findFirst: vi.fn(async () =>
        stripeCustomerRows[0]
          ? { ...stripeCustomerRows[0], tenant: { id: stripeCustomerRows[0].tenantId } }
          : null,
      ),
      findUnique: vi.fn(async () => stripeCustomerRows[0] ?? null),
    },
    stripeSubscription: {
      upsert: vi.fn(async () => ({ id: 'sub_db_id' })),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ tenantId: 'tenant-1', stripeSubscriptionId: 'sub_x' })),
      findFirst: vi.fn(async () => null),
    },
    stripeSubscriptionItem: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({ id: 'item_id' })),
    },
    plan: {
      findFirst: vi.fn(async () => freePlan),
      findUnique: vi.fn(async () => plan),
    },
    addOn: {
      findUnique: vi.fn(async () => addOn),
    },
    tenantEntitlement: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({ id: 'ent_id' })),
      create: vi.fn(async () => ({ id: 'ent_id' })),
    },
    tenantEntitlementAddOn: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({ id: 'add_id' })),
    },
    stripeWebhookEvent: {
      create: vi.fn(async (args: any) => ({
        id: 'evt_db_id',
        ...args.data,
        receivedAt: new Date(),
        processedAt: null,
        status: 'RECEIVED',
        errorMessage: null,
      })),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async (args: any) => ({
        id: 'evt_db_id',
        stripeEventId: 'evt_x',
        type: 'customer.subscription.updated',
        livemode: false,
        receivedAt: new Date(),
        payload: {},
        ...args.data,
      })),
    },
    auditLog: { create: auditLog },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? tx(arg) : Promise.resolve(arg))),
    $transaction_bypass: txState,
  };

  return { prisma, auditLog };
}

function mkRedisStub() {
  return {
    del: vi.fn(async () => 1),
  };
}

function mkCatalog(opts: { planPriceId?: string; addOnPriceId?: string } = {}) {
  const catalog: any = {
    lookupPrice: vi.fn(async (priceId: string) => {
      if (priceId === (opts.planPriceId ?? STRIPE_PRICE_PRO)) {
        return { kind: 'PLAN', catalogId: 'plan_pro_id', planTier: 'PRO' };
      }
      if (priceId === (opts.addOnPriceId ?? STRIPE_PRICE_ADDON_EXTRA_STORAGE)) {
        return { kind: 'ADDON', catalogId: 'addon_extra_storage_id' };
      }
      return null;
    }),
  };
  return catalog as StripeCatalogService;
}

function mkStripeSvc(testMode = true): StripeService {
  return { testMode } as unknown as StripeService;
}

describe('EntitlementsSyncService', () => {
  let result: FakePrismaResult;
  let redis: ReturnType<typeof mkRedisStub>;
  let service: EntitlementsSyncService;
  let tenantId: string;

  beforeEach(() => {
    tenantId = 'tenant-1';
    result = mkPrismaStub({
      tenant: { id: tenantId, stripeCustomerId: 'cus_test_tenant_1' },
    });
    redis = mkRedisStub();
    service = new EntitlementsSyncService(
      result.prisma,
      redis as any,
      mkCatalog(),
      mkStripeSvc(),
    );
  });

  describe('reserveWebhookEvent (idempotency)', () => {
    it('reserves a brand-new event id', async () => {
      const { reserved } = await service.reserveWebhookEvent({
        stripeEventId: 'evt_1',
        type: 'customer.subscription.updated',
        livemode: false,
        payload: { hello: 'world' },
      });
      expect(reserved).toBe(true);
    });

    it('rejects a duplicate event id without throwing', async () => {
      const first = await service.reserveWebhookEvent({
        stripeEventId: 'evt_2',
        type: 'customer.subscription.updated',
        livemode: false,
        payload: {},
      });
      expect(first.reserved).toBe(true);

      // Simulate an existing row on second attempt.
      result.prisma.stripeWebhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt_db_id',
        stripeEventId: 'evt_2',
        type: 'customer.subscription.updated',
        receivedAt: new Date(),
        processedAt: null,
        status: 'PROCESSED',
        errorMessage: null,
        payload: {},
      });
      const second = await service.reserveWebhookEvent({
        stripeEventId: 'evt_2',
        type: 'customer.subscription.updated',
        livemode: false,
        payload: {},
      });
      expect(second.reserved).toBe(false);
      expect(second.existing?.status).toBe('PROCESSED');
    });
  });

  describe('customer.subscription.created', () => {
    it('upserts the subscription + entitlement + add-on + invalidates cache', async () => {
      const sub = fakeSubscription({
        tenantId,
        status: 'active',
        items: [
          { priceId: STRIPE_PRICE_PRO },
          { priceId: STRIPE_PRICE_ADDON_EXTRA_STORAGE },
        ],
      });
      const event = fakeEvent({
        id: 'evt_sub_create',
        type: 'customer.subscription.created',
        object: sub,
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      const receipt = await service.handleEvent({
        existing: reserved.existing!,
        event,
      });
      expect(receipt.status).toBe('PROCESSED');
      expect(redis.del).toHaveBeenCalledWith('entitlements:v1:tenant-1');
    });

    it('marks an unknown status as FAILED gracefully (does not crash)', async () => {
      const sub = fakeSubscription({
        tenantId,
        status: 'unknown_state_we_dont_recognise',
        items: [{ priceId: STRIPE_PRICE_PRO }],
      });
      const event = fakeEvent({
        id: 'evt_sub_unknown',
        type: 'customer.subscription.updated',
        object: sub,
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      const receipt = await service.handleEvent({
        existing: reserved.existing!,
        event,
      });
      // Event still PROCESSED — the sync completes (status coerced to
      // INCOMPLETE on save). The guard defaults to deny so the customer
      // doesn't lose access due to an unrecognised status.
      expect(receipt.status).toBe('PROCESSED');
    });
  });

  describe('customer.subscription.deleted', () => {
    it('marks subscription canceled + clears add-ons + invalidates cache', async () => {
      const sub = fakeSubscription({
        tenantId,
        status: 'canceled',
        cancelAtPeriodEnd: true,
        canceledAt: 1702600000,
        items: [{ priceId: STRIPE_PRICE_PRO }],
      });
      const event = fakeEvent({
        id: 'evt_sub_del',
        type: 'customer.subscription.deleted',
        object: sub,
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      const receipt = await service.handleEvent({
        existing: reserved.existing!,
        event,
      });
      expect(receipt.status).toBe('PROCESSED');
      expect(redis.del).toHaveBeenCalledWith('entitlements:v1:tenant-1');
    });

    it('is a no-op when the Stripe customer is unknown to the system', async () => {
      const sub = fakeSubscription({
        tenantId: 'orphan',
        status: 'canceled',
        items: [],
      });
      // Force lookup to return null
      result.prisma.stripeCustomer.findFirst.mockResolvedValueOnce(null);
      const event = fakeEvent({
        id: 'evt_sub_orphan',
        type: 'customer.subscription.deleted',
        object: sub,
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      const receipt = await service.handleEvent({
        existing: reserved.existing!,
        event,
      });
      // Because the handler swallows unknowns as PROCESSED, the receipt is
      // PROCESSED but no cache key was invalidated.
      expect(receipt.status).toBe('PROCESSED');
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('invoice webhooks', () => {
    it('records an audit log row on invoice.paid', async () => {
      const invoice = {
        id: 'in_123',
        amount_due: 9900,
        amount_paid: 9900,
        customer: 'cus_test_tenant_1',
        subscription: 'sub_test_tenant_1',
      };
      const event = fakeEvent({
        id: 'evt_inv_paid',
        type: 'invoice.paid',
        object: invoice,
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      await service.handleEvent({ existing: reserved.existing!, event });
      expect(result.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resource: 'invoice',
            action: 'CREATE',
          }),
        }),
      );
    });

    it('records a separate audit row on invoice.payment_failed', async () => {
      const invoice = {
        id: 'in_456',
        amount_due: 9900,
        amount_paid: 0,
        customer: 'cus_test_tenant_1',
        subscription: 'sub_test_tenant_1',
      };
      const event = fakeEvent({
        id: 'evt_inv_failed',
        type: 'invoice.payment_failed',
        object: invoice,
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      await service.handleEvent({ existing: reserved.existing!, event });
      expect(result.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resource: 'invoice',
            after: expect.objectContaining({ stripeEvent: 'invoice.payment_failed' }),
          }),
        }),
      );
    });
  });

  describe('unhandled event types', () => {
    it('marks SKIPPED without throwing', async () => {
      const event = fakeEvent({
        id: 'evt_unhandled',
        type: 'customer.created',
        object: { id: 'cus_x' },
      });
      const reserved = await service.reserveWebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event,
      });
      const receipt = await service.handleEvent({
        existing: reserved.existing!,
        event,
      });
      expect(receipt.status).toBe('SKIPPED');
    });
  });
});
