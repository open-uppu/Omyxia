/**
 * omyxia v2.0.0 P4.1 — Stripe fixture payloads.
 *
 * Sample Stripe SDK-shaped objects used by the webhook sync tests and
 * the controller tests. We keep these hand-rolled (rather than reading
 * Stripe's published fixture files) so the tests don't break when the
 * SDK version is bumped.
 */

export const STRIPE_PRICE_PRO = 'price_pro_monthly_test';
export const STRIPE_PRICE_ENTERPRISE = 'price_enterprise_monthly_test';
export const STRIPE_PRICE_ADDON_EXTRA_STORAGE = 'price_addon_extra_storage_test';
export const STRIPE_PRICE_ADDON_PRIORITY_SUPPORT = 'price_addon_priority_support_test';

export interface FakeStripeCustomer {
  id: string;
  email: string;
  name: string;
  metadata: { tenantId: string; slug: string };
  livemode: boolean;
}

export interface FakeStripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  canceled_at: number | null;
  trial_start: number | null;
  trial_end: number | null;
  items: {
    data: Array<{
      id: string;
      price: { id: string };
      quantity: number;
    }>;
  };
  livemode: boolean;
  metadata: { tenantId: string; planTier: string; addOnIds: string };
}

export interface FakeStripeEvent<T = unknown> {
  id: string;
  type: string;
  data: { object: T };
  livemode: boolean;
  created: number;
}

export function fakeCustomer(tenantId: string): FakeStripeCustomer {
  return {
    id: `cus_test_${tenantId.replace(/[^a-z0-9]/g, '')}`,
    email: 'owner@example.test',
    name: 'ACME Co',
    metadata: { tenantId, slug: tenantId },
    livemode: false,
  };
}

export function fakeSubscription(opts: {
  tenantId: string;
  status?: string;
  items: Array<{ id?: string; priceId: string; quantity?: number }>;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number | null;
  customer?: string;
}): FakeStripeSubscription {
  const customer = opts.customer ?? `cus_test_${opts.tenantId.replace(/[^a-z0-9]/g, '')}`;
  return {
    id: `sub_test_${opts.tenantId.replace(/[^a-z0-9]/g, '')}`,
    customer,
    status: opts.status ?? 'active',
    current_period_start: 1700000000,
    current_period_end: 1702592000,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    cancel_at: null,
    canceled_at: opts.canceledAt ?? null,
    trial_start: null,
    trial_end: null,
    items: {
      data: opts.items.map((item, idx) => ({
        id: item.id ?? `si_test_${opts.tenantId.replace(/[^a-z0-9]/g, '')}_${idx}`,
        price: { id: item.priceId },
        quantity: item.quantity ?? 1,
      })),
    },
    livemode: false,
    metadata: { tenantId: opts.tenantId, planTier: 'PRO', addOnIds: '' },
  };
}

export function fakeEvent<T>(opts: {
  id: string;
  type: string;
  object: T;
  livemode?: boolean;
}): FakeStripeEvent<T> {
  return {
    id: opts.id,
    type: opts.type,
    data: { object: opts.object },
    livemode: opts.livemode ?? false,
    created: 1700000000,
  };
}
