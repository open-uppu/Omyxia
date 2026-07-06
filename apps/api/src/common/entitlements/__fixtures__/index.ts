/**
 * Test fixtures for the entitlements module.
 *
 * Reusable builders keep tests readable. The `mkPrismaStub` shim
 * builds a Prisma-like object that returns only the models our service
 * touches, so tests don't need an actual PrismaClient.
 */
import type { TenantEntitlements } from '../entitlement.types';

/** Build a minimal TenantEntitlements payload for assertions. */
export function mkEntitlements(
  overrides: Partial<TenantEntitlements> = {},
): TenantEntitlements {
  return {
    tenantId: 'tenant-1',
    planId: 'plan-pro',
    planTier: 'PRO',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    features: {
      'module.crm': true,
      'module.hr': true,
      'module.erp': false,
      'module.bi': false,
      'module.documents': true,
      'admin.tenants': true,
      'admin.audit': true,
    },
    limits: {
      'limit.maxEmployees': 25,
      'limit.maxStorageGB': 50,
      'limit.maxUsers': 10,
      'limit.maxLeads': null,
    },
    addOns: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a Prisma stub that responds to the queries `EntitlementsService`
 * actually issues (e.g. `tenantEntitlement.findFirst`).
 */
export function mkPrismaStub(overrides: any = {}) {
  return {
    tenantEntitlement: {
      findFirst: async () => null,
      ...overrides.tenantEntitlement,
    },
    employee: { count: async () => 0, ...overrides.employee },
    crmLead: { count: async () => 0, ...overrides.crmLead },
    userTenant: { count: async () => 0, ...overrides.userTenant },
    project: { count: async () => 0, ...overrides.project },
    ticket: { count: async () => 0, ...overrides.ticket },
  };
}

/** Build a Redis stub (LRU-style, in-memory). */
export function mkRedisStub(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    _store: store,
    async get(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK' as const;
    },
    async del(key: string) {
      const had = store.delete(key);
      return had ? 1 : 0;
    },
    async publish() {
      return 1;
    },
  };
}
