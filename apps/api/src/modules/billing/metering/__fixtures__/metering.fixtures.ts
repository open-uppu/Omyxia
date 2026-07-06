/**
 * omyxia v2.0.0 P4.2 — Usage-metering fixtures.
 *
 * Hand-rolled Prisma row shapes used by the metering unit tests. We
 * keep these small and explicit so the tests don't have to fight with
 * the full Prisma client surface.
 */

import type { Tenant, UsageMeter } from '@prisma/client';

export function tenantRecord(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    slug: 'acme',
    name: 'ACME Co',
    plan: 'GROWTH',
    status: 'ACTIVE',
    domain: null,
    region: null,
    settings: {},
    stripeCustomerId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Tenant;
}

export const ALL_METERS: UsageMeter[] = ['STORAGE_GB_HOURS', 'API_CALL_COUNT', 'ACTIVE_USERS'];

export function planUsageQuota(overrides: Partial<{
  id: string;
  planId: string;
  storageGb: number | null;
  apiCalls: number | null;
  activeUsers: number | null;
  storageOveragePrice: number | null;
  apiCallOveragePrice: number | null;
  activeUserOveragePrice: number | null;
  apiCallsHardCap: number | null;
}> = {}) {
  return {
    id: 'quota-1',
    planId: 'plan-pro',
    storageGb: 100,
    apiCalls: 100000,
    activeUsers: 25,
    storageOveragePrice: 0.1,
    apiCallOveragePrice: 0.001,
    activeUserOveragePrice: 5,
    apiCallsHardCap: 1000000,
    ...overrides,
  };
}

export function stripeCustomerRecord(overrides: Partial<{
  id: string;
  tenantId: string;
  stripeCustomerId: string;
  email: string | null;
  name: string | null;
  livemode: boolean;
}> = {}) {
  return {
    id: 'sc-1',
    tenantId: 'tenant-1',
    stripeCustomerId: 'cus_test_tenant1',
    email: 'owner@acme.test',
    name: 'ACME Co',
    livemode: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function stripeSubscriptionRecord(overrides: Partial<{
  id: string;
  tenantId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  canceledAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'sub-1',
    tenantId: 'tenant-1',
    stripeSubscriptionId: 'sub_test_tenant1_pro',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    trialStart: null,
    trialEnd: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function stripeSubscriptionItemRecord(overrides: Partial<{
  id: string;
  subscriptionId: string;
  stripeSubscriptionItemId: string;
  stripePriceId: string;
  kind: 'BASE_PLAN' | 'ADDON';
  addOnId: string | null;
  planId: string | null;
  quantity: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'item-1',
    subscriptionId: 'sub-1',
    stripeSubscriptionItemId: 'si_test_tenant1_storage',
    stripePriceId: 'price_storage_metered_test',
    kind: 'ADDON' as const,
    addOnId: null,
    planId: 'plan-pro',
    quantity: 1,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function meteredSubscriptionItemRecord(overrides: Partial<{
  id: string;
  subscriptionItemId: string;
  meter: UsageMeter;
  stripeSubscriptionItemId: string | null;
  stripeMeteredPriceId: string;
  reportingUnit: string;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'metered-1',
    subscriptionItemId: 'item-1',
    meter: 'STORAGE_GB_HOURS' as UsageMeter,
    stripeSubscriptionItemId: 'si_test_tenant1_storage',
    stripeMeteredPriceId: 'price_storage_metered_test',
    reportingUnit: 'GB-hour',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}