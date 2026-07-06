/**
 * omyxia v2.0.0 P4.2 — UsageAdminController tests.
 *
 * The full NestJS testing harness would require setting up the auth
 * guard + RolesGuard + validation pipes, which is heavy for the value
 * we get. Instead we test the controller as a class:
 *
 *   1. `health` is a pure read — no DB calls — so we can call it directly.
 *   2. `quota` returns the parsed `PlanUsageQuota` row.
 *   3. `tenantSummary` returns the daily rollups + optional monthly +
 *      overage rows.
 *   4. Validation rejects malformed bodies for `record` + `sync-now` +
 *      `recompute`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageAdminController } from './usage-admin.controller';
import { tenantRecord } from './__fixtures__/metering.fixtures';

function mkStub() {
  return {
    collector: {
      listDaily: vi.fn(async () => []),
      recordEvent: vi.fn(async () => ({})),
    },
    aggregation: {
      recomputeTenantDay: vi.fn(async () => ({})),
      recomputeAllForDay: vi.fn(async () => 0),
    },
    stripe: {
      listReportsForPeriod: vi.fn(async () => []),
    },
    overage: {
      listOverageForTenant: vi.fn(async () => []),
    },
    cron: {
      runMonthlyReportWithOptions: vi.fn(async () => ({
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        totalTenants: 0,
        totalReports: 0,
        succeeded: 0,
        failed: 0,
        tenants: [],
      })),
      runOverageInvoicingWithOptions: vi.fn(async () => ({
        period: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        totalSucceeded: 0,
        totalFailed: 0,
        totalSkipped: 0,
        totalAmount: '0',
      })),
    },
    prisma: {
      planUsageQuota: {
        findUnique: vi.fn(async () => null),
      },
    },
  };
}

describe('UsageAdminController', () => {
  let stubs: ReturnType<typeof mkStub>;

  beforeEach(() => {
    stubs = mkStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('health', () => {
    it('returns the cron schedule + retention window', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.health();
      expect(result.ok).toBe(true);
      expect(result.cronSchedules.dailyAggregation).toBeDefined();
      expect(result.cronSchedules.monthlyReporting).toBeDefined();
      expect(result.cronSchedules.overageInvoicing).toBeDefined();
      expect(result.cronSchedules.eventRetention).toBeDefined();
      expect(result.retentionDays).toBeGreaterThan(0);
      expect(typeof result.now).toBe('string');
    });
  });

  describe('quota', () => {
    it('throws NotFoundException when no quota is configured', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      await expect(ctrl.quota('plan-x')).rejects.toThrow(/No quota configured/);
    });

    it('returns the parsed quota row', async () => {
      stubs.prisma.planUsageQuota.findUnique = vi.fn(async () => ({
        planId: 'plan-pro',
        storageGb: { toString: () => '100' },
        apiCalls: 100000,
        activeUsers: 25,
        storageOveragePrice: { toString: () => '0.1' },
        apiCallOveragePrice: { toString: () => '0.001' },
        activeUserOveragePrice: { toString: () => '5' },
        apiCallsHardCap: 1000000,
      } as any));
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.quota('plan-pro');
      expect(result.planId).toBe('plan-pro');
      expect(result.storageGb).toBe('100');
      expect(result.apiCallsHardCap).toBe(1000000);
    });
  });

  describe('tenantSummary', () => {
    it('returns daily rollups per meter + null monthly/overage', async () => {
      stubs.collector.listDaily = vi.fn(async () => [
        {
          id: 'daily-1',
          tenantId: 't1',
          meter: 'API_CALL_COUNT',
          usageDate: '2026-06-15',
          quantity: '100',
          breakdown: null,
          createdAt: '2026-06-15T00:00:00Z',
          updatedAt: '2026-06-15T00:00:00Z',
        },
      ]);
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.tenantSummary('t1', '2026-06-01', '2026-06-30');
      expect(result.tenantId).toBe('t1');
      expect(result.periodStart).toBe('2026-06-01');
      expect(result.periodEnd).toBe('2026-06-30');
      expect(result.meters.length).toBe(3);
      const apiMeter = result.meters.find((m) => m.meter === 'API_CALL_COUNT');
      expect(apiMeter?.daily.length).toBe(1);
      expect(apiMeter?.monthly).toBeNull();
      expect(apiMeter?.overage).toBeNull();
    });

    it('rejects malformed date strings', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      await expect(ctrl.tenantSummary('t1', 'bad-date')).rejects.toThrow(/must be YYYY-MM-DD/);
    });

    it('rejects unknown meter', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      await expect(ctrl.tenantSummary('t1', '2026-06-01', '2026-06-30', 'BOGUS')).rejects.toThrow(
        /meter must be one of/,
      );
    });
  });

  describe('record', () => {
    it('parses a valid body and calls collector.recordEvent', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.record({
        tenantId: 't1',
        meter: 'API_CALL_COUNT',
        quantity: '1',
        source: 'api_request',
      });
      expect(result.ok).toBe(true);
      expect(stubs.collector.recordEvent).toHaveBeenCalledOnce();
    });

    it('rejects an invalid body', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      await expect(
        ctrl.record({ tenantId: 't1' } as any),
      ).rejects.toThrow();
    });

    it('rejects a negative quantity', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      await expect(
        ctrl.record({
          tenantId: 't1',
          meter: 'API_CALL_COUNT',
          quantity: '-1',
          source: 'api_request',
        }),
      ).rejects.toThrow();
    });
  });

  describe('syncNow', () => {
    it('invokes the monthly cron with the supplied options', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.syncNow({ periodStart: '2026-06-01', periodEnd: '2026-06-30' });
      expect(stubs.cron.runMonthlyReportWithOptions).toHaveBeenCalledOnce();
      expect(stubs.cron.runOverageInvoicingWithOptions).toHaveBeenCalledOnce();
      expect(result.overage).toBeDefined();
    });

    it('skips overage when includeOverage=false', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.syncNow({ includeOverage: false });
      expect(stubs.cron.runMonthlyReportWithOptions).toHaveBeenCalledOnce();
      expect(stubs.cron.runOverageInvoicingWithOptions).not.toHaveBeenCalled();
      expect((result as any).overage).toBeUndefined();
    });
  });

  describe('recompute', () => {
    it('recomputes for one tenant across all meters', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.recompute({ usageDate: '2026-06-15', tenantId: 't1' });
      expect(result.ok).toBe(true);
      expect(stubs.aggregation.recomputeTenantDay).toHaveBeenCalledTimes(3);
    });

    it('recomputes all tenants when tenantId is omitted', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      const result = await ctrl.recompute({ usageDate: '2026-06-15' });
      expect(result.ok).toBe(true);
      expect(stubs.aggregation.recomputeAllForDay).toHaveBeenCalledOnce();
    });

    it('rejects a malformed usageDate', async () => {
      const ctrl = new UsageAdminController(
        stubs.collector as any,
        stubs.aggregation as any,
        stubs.stripe as any,
        stubs.overage as any,
        stubs.cron as any,
        stubs.prisma as any,
      );
      await expect(ctrl.recompute({ usageDate: 'bad' })).rejects.toThrow();
    });
  });
});