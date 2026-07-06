/**
 * omyxia v2.0.0 P4.2 — MeteringCronService tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeteringCronService } from './metering-cron.service';
import { tenantRecord } from './__fixtures__/metering.fixtures';

function mkRedisStub() {
  const store = new Map<string, string>();
  return {
    getClient: () => ({
      set: vi.fn(async (key: string, value: string) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        const had = store.has(key);
        store.delete(key);
        return had ? 1 : 0;
      }),
    }),
    state: store,
  };
}

function mkPrismaStub(opts: { tenants?: any[]; events?: any[] } = {}) {
  const events = opts.events ?? [];
  return {
    prisma: {
      tenantUsageDaily: {
        findMany: vi.fn(async (args: any) => {
          if (args.select?.tenantId && args.distinct?.includes('tenantId')) {
            const ids = Array.from(new Set(events.map((e: any) => e.tenantId)));
            return ids.map((id) => ({ tenantId: id }));
          }
          return [];
        }),
      },
      tenantUsageEvent: {
        findMany: vi.fn(async () => events.slice(0, 100).map((e) => ({ id: e.id }))),
        deleteMany: vi.fn(async () => ({ count: events.length })),
      },
      tenant: {
        findMany: vi.fn(async () => opts.tenants ?? [tenantRecord({ id: 'tenant-1' })]),
      },
    } as any,
  };
}

function mkAggregation() {
  return {
    recomputeAllForDay: vi.fn(async () => 0),
    listBillableTenantsForPeriod: vi.fn(async () => [tenantRecord({ id: 'tenant-1' })]),
    aggregateMonthlyForTenant: vi.fn(async () => [
      { tenantId: 'tenant-1', meter: 'API_CALL_COUNT', periodStart: '2026-06-01', periodEnd: '2026-06-30', quantity: '1000' },
      { tenantId: 'tenant-1', meter: 'STORAGE_GB_HOURS', periodStart: '2026-06-01', periodEnd: '2026-06-30', quantity: '50' },
      { tenantId: 'tenant-1', meter: 'ACTIVE_USERS', periodStart: '2026-06-01', periodEnd: '2026-06-30', quantity: '0' },
    ]),
  } as any;
}

function mkStripe() {
  return {
    pushUsageRecord: vi.fn(async (input: any) => ({
      report: {
        id: 'rep-1',
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        quantity: input.quantity,
        status: 'SYNCED',
        stripeUsageRecordId: `mbur_test_${input.meter.toLowerCase()}`,
        stripeSubscriptionItemId: 'si_test',
        errorMessage: null,
        attempts: 1,
        reportedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pushed: true,
    })),
  } as any;
}

function mkOverage() {
  return {
    invoiceAllOverageForPeriod: vi.fn(async () => [
      {
        tenantId: 'tenant-1',
        totalOverageItems: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        invoiceItemIds: { STORAGE_GB_HOURS: null, API_CALL_COUNT: null, ACTIVE_USERS: null },
        totalAmount: '0',
        errors: {},
      },
    ]),
  } as any;
}

describe('MeteringCronService', () => {
  let redis: ReturnType<typeof mkRedisStub>;
  let prisma: ReturnType<typeof mkPrismaStub>;
  let aggregation: ReturnType<typeof mkAggregation>;
  let stripe: ReturnType<typeof mkStripe>;
  let overage: ReturnType<typeof mkOverage>;

  beforeEach(() => {
    redis = mkRedisStub();
    prisma = mkPrismaStub();
    aggregation = mkAggregation();
    stripe = mkStripe();
    overage = mkOverage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runMonthlyReportWithOptions', () => {
    it('pushes non-zero usage records to Stripe', async () => {
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runMonthlyReportWithOptions({
        skipLock: true,
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      });
      expect(result.totalTenants).toBe(1);
      expect(result.succeeded).toBe(2); // API_CALL_COUNT + STORAGE_GB_HOURS, ACTIVE_USERS is 0
      expect(result.failed).toBe(0);
      expect(stripe.pushUsageRecord).toHaveBeenCalledTimes(2);
    });

    it('skips tenants with no data', async () => {
      aggregation.listBillableTenantsForPeriod = vi.fn(async () => []);
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runMonthlyReportWithOptions({
        skipLock: true,
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      });
      expect(result.totalTenants).toBe(0);
      expect(stripe.pushUsageRecord).not.toHaveBeenCalled();
    });

    it('captures errors per tenant', async () => {
      stripe.pushUsageRecord = vi.fn(async () => {
        throw new Error('Stripe down');
      });
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runMonthlyReportWithOptions({
        skipLock: true,
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      });
      // The throw is caught at the tenant level — pushMonthlyForTenant
      // is treated as a single failed tenant (not per-meter).
      expect(result.failed).toBe(1);
      expect(result.tenants[0].errors.ACTIVE_USERS).toBe('Stripe down');
    });

    it('respects tenantLimit', async () => {
      aggregation.listBillableTenantsForPeriod = vi.fn(async () => [
        tenantRecord({ id: 'tenant-1' }),
        tenantRecord({ id: 'tenant-2' }),
        tenantRecord({ id: 'tenant-3' }),
      ]);
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runMonthlyReportWithOptions({
        skipLock: true,
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        tenantLimit: 1,
      });
      expect(result.totalTenants).toBe(1);
    });

    it('acquires and releases the Redis lock', async () => {
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      await svc.runMonthlyReportWithOptions({
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      });
      // Lock should be released after run
      expect(redis.state.size).toBe(0);
    });
  });

  describe('runOverageInvoicingWithOptions', () => {
    it('aggregates overage results', async () => {
      overage.invoiceAllOverageForPeriod = vi.fn(async () => [
        {
          tenantId: 'tenant-1',
          totalOverageItems: 2,
          succeeded: 1,
          failed: 1,
          skipped: 0,
          invoiceItemIds: {
            STORAGE_GB_HOURS: 'ii_test_storage',
            API_CALL_COUNT: null,
            ACTIVE_USERS: null,
          },
          totalAmount: '5',
          errors: { API_CALL_COUNT: 'Stripe error' },
        },
      ]);
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runOverageInvoicingWithOptions({
        skipLock: true,
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      });
      expect(result.totalSucceeded).toBe(1);
      expect(result.totalFailed).toBe(1);
      expect(result.totalAmount).toBe('5.00');
    });
  });

  describe('runRetentionWithOptions', () => {
    it('prunes old events', async () => {
      const events = Array.from({ length: 100 }, (_, i) => ({ id: `event-${i}` }));
      prisma = mkPrismaStub({ events });
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runRetentionWithOptions({ skipLock: true });
      expect(result.deleted).toBeGreaterThan(0);
      expect(typeof result.beforeDate).toBe('string');
    });

    it('returns 0 when no events to prune', async () => {
      prisma = mkPrismaStub({ events: [] });
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.runRetentionWithOptions({ skipLock: true });
      expect(result.deleted).toBe(0);
    });
  });

  describe('runDailyAggregationWithOptions', () => {
    it('delegates to aggregation.recomputeAllForDay', async () => {
      aggregation.recomputeAllForDay = vi.fn(async () => 5);
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      await svc.runDailyAggregationWithOptions({ skipLock: true });
      expect(aggregation.recomputeAllForDay).toHaveBeenCalledOnce();
    });
  });

  describe('pushMonthlyForTenant', () => {
    it('skips zero-quantity meters', async () => {
      aggregation.aggregateMonthlyForTenant = vi.fn(async () => [
        { tenantId: 'tenant-1', meter: 'API_CALL_COUNT', periodStart: '2026-06-01', periodEnd: '2026-06-30', quantity: '100' },
        { tenantId: 'tenant-1', meter: 'STORAGE_GB_HOURS', periodStart: '2026-06-01', periodEnd: '2026-06-30', quantity: '0' },
        { tenantId: 'tenant-1', meter: 'ACTIVE_USERS', periodStart: '2026-06-01', periodEnd: '2026-06-30', quantity: '0' },
      ]);
      const svc = new MeteringCronService(prisma.prisma, redis as any, aggregation, stripe, overage);
      const result = await svc.pushMonthlyForTenant(tenantRecord({ id: 'tenant-1' }), {
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      });
      expect(result.totalReports).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(stripe.pushUsageRecord).toHaveBeenCalledOnce();
    });
  });
});