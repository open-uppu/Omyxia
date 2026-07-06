/**
 * omyxia v2.0.0 P4.2 — OverageInvoiceService tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverageInvoiceService } from './overage-invoice.service';

interface OverageRow {
  id: string;
  tenantId: string;
  meter: string;
  periodStart: Date;
  periodEnd: Date;
  includedQuantity: string;
  actualQuantity: string;
  overageQuantity: string;
  unitPrice: string;
  amount: string;
  currency: string;
  status: string;
  errorMessage: string | null;
  stripeInvoiceItemId: string | null;
  stripeInvoiceId: string | null;
  attempts: number;
  invoicedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mkPrismaStub(opts: { quota?: any; entitlement?: any; dailyByTenant?: Record<string, Array<{ meter: string; quantity: string }>> } = {}) {
  const overages: OverageRow[] = [];
  let overageCounter = 0;
  const dailyByTenant = opts.dailyByTenant ?? {};

  return {
    prisma: {
      planUsageQuota: {
        findUnique: vi.fn(async (args: { where: { planId: string } }) => opts.quota ?? null),
      },
      tenantEntitlement: {
        findFirst: vi.fn(async () => opts.entitlement ?? null),
      },
      tenantUsageDaily: {
        findMany: vi.fn(async (args: { where?: any } = {}) => {
          let rows: Array<{ tenantId: string; meter: string; quantity: string }> = [];
          for (const [tenantId, list] of Object.entries(dailyByTenant)) {
            rows = rows.concat(list.map((r) => ({ tenantId, ...r })));
          }
          if (args.where?.tenantId) rows = rows.filter((r) => r.tenantId === args.where.tenantId);
          if (args.where?.usageDate?.gte) {
            const start = args.where.usageDate.gte;
            rows = rows.filter((r) => true); // stub: all rows in range
          }
          return rows;
        }),
      },
      overageInvoiceItem: {
        upsert: vi.fn(async (args: { where: any; create: any; update: any }) => {
          const existing = overages.find(
            (r) =>
              r.tenantId === args.where.tenantId_meter_periodStart.tenantId &&
              r.meter === args.where.tenantId_meter_periodStart.meter &&
              r.periodStart.getTime() === args.where.tenantId_meter_periodStart.periodStart.getTime(),
          );
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          overageCounter += 1;
          const now = new Date();
          const row: OverageRow = {
            id: `overage-${overageCounter}`,
            createdAt: now,
            updatedAt: now,
            ...args.create,
          };
          overages.push(row);
          return row;
        }),
        findMany: vi.fn(async () => overages),
      },
      tenant: {
        findMany: vi.fn(async () => [{ id: 'tenant-1' }]),
      },
    } as any,
    state: { overages },
  };
}

function mkStripe() {
  return {
    pushOverageInvoiceItem: vi.fn(async (input: any) => {
      // Simulate Stripe invoice item creation
      const amountNum = Number(input.amount);
      return {
        id: `overage-${input.tenantId}-${input.meter}`,
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        includedQuantity: input.includedQuantity,
        actualQuantity: input.actualQuantity,
        overageQuantity: input.overageQuantity,
        unitPrice: input.unitPrice,
        amount: input.amount,
        currency: input.currency,
        status: 'INVOICED',
        errorMessage: null,
        stripeInvoiceItemId: `ii_test_${input.meter.toLowerCase()}`,
        stripeInvoiceId: null,
        attempts: 1,
        invoicedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
  } as any;
}

describe('OverageInvoiceService', () => {
  let stub: ReturnType<typeof mkPrismaStub>;
  let stripe: ReturnType<typeof mkStripe>;

  beforeEach(() => {
    stub = mkPrismaStub();
    stripe = mkStripe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeOverage', () => {
    it('returns zero overage when within included quota', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: { toString: () => '100' },
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: { toString: () => '0.1' },
          apiCallOveragePrice: { toString: () => '0.001' },
          activeUserOveragePrice: { toString: () => '5' },
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.computeOverage({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantity: '50',
        planId: 'plan-1',
      });
      expect(result.overageQuantity).toBe('0');
      expect(result.billable).toBe(false);
      expect(result.reason).toBe('within included quota');
    });

    it('returns billable overage when above quota', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: { toString: () => '100' },
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: { toString: () => '0.1' },
          apiCallOveragePrice: { toString: () => '0.001' },
          activeUserOveragePrice: { toString: () => '5' },
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.computeOverage({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantity: '150',
        planId: 'plan-1',
      });
      expect(result.overageQuantity).toBe('50');
      expect(result.amount).toBe('5'); // 50 * 0.1
      expect(result.billable).toBe(true);
    });

    it('returns not-billable when plan has no unit price', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: { toString: () => '100' },
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: null,
          apiCallOveragePrice: null,
          activeUserOveragePrice: null,
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.computeOverage({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantity: '150',
        planId: 'plan-1',
      });
      expect(result.overageQuantity).toBe('50');
      expect(result.billable).toBe(false);
      expect(result.amount).toBeNull();
    });

    it('returns not-billable when plan has no quota', async () => {
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.computeOverage({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantity: '150',
        planId: null,
      });
      expect(result.billable).toBe(false);
      expect(result.reason).toBe('no plan quota configured');
    });

    it('returns not-billable when quota meter is unlimited (null)', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: null,
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: { toString: () => '0.1' },
          apiCallOveragePrice: { toString: () => '0.001' },
          activeUserOveragePrice: { toString: () => '5' },
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.computeOverage({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantity: '1000000',
        planId: 'plan-1',
      });
      expect(result.billable).toBe(false);
      expect(result.reason).toBe('no plan quota configured');
    });
  });

  describe('invoiceOverageForTenant', () => {
    it('skips when no overage', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: { toString: () => '100' },
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: { toString: () => '0.1' },
          apiCallOveragePrice: { toString: () => '0.001' },
          activeUserOveragePrice: { toString: () => '5' },
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.invoiceOverageForTenant({
        tenantId: 'tenant-1',
        planId: 'plan-1',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantities: {
          STORAGE_GB_HOURS: '50',
          API_CALL_COUNT: '1000',
          ACTIVE_USERS: '5',
        },
      });
      expect(result.totalOverageItems).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.skipped).toBe(3);
      expect(stripe.pushOverageInvoiceItem).not.toHaveBeenCalled();
    });

    it('invoices overage items to Stripe', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: { toString: () => '100' },
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: { toString: () => '0.1' },
          apiCallOveragePrice: { toString: () => '0.001' },
          activeUserOveragePrice: { toString: () => '5' },
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.invoiceOverageForTenant({
        tenantId: 'tenant-1',
        planId: 'plan-1',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantities: {
          STORAGE_GB_HOURS: '150', // 50 over × $0.10 = $5
          API_CALL_COUNT: '120000', // 20000 over × $0.001 = $20
          ACTIVE_USERS: '5', // within quota
        },
      });
      expect(result.succeeded).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.totalAmount).toBe('25'); // $5 + $20
      expect(stripe.pushOverageInvoiceItem).toHaveBeenCalledTimes(2);
    });

    it('skips when no plan', async () => {
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const result = await svc.invoiceOverageForTenant({
        tenantId: 'tenant-1',
        planId: null,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantities: {
          STORAGE_GB_HOURS: '1000',
          API_CALL_COUNT: '1000000',
          ACTIVE_USERS: '100',
        },
      });
      expect(result.totalOverageItems).toBe(0);
      expect(stripe.pushOverageInvoiceItem).not.toHaveBeenCalled();
    });
  });

  describe('computeOverageForTenant', () => {
    it('returns one ComputeOverageResult per meter', async () => {
      stub = mkPrismaStub({
        quota: {
          storageGb: { toString: () => '100' },
          apiCalls: 100000,
          activeUsers: 25,
          storageOveragePrice: { toString: () => '0.1' },
          apiCallOveragePrice: { toString: () => '0.001' },
          activeUserOveragePrice: { toString: () => '5' },
        },
      });
      const svc = new OverageInvoiceService(stub.prisma, stripe);
      const results = await svc.computeOverageForTenant({
        tenantId: 'tenant-1',
        planId: 'plan-1',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        actualQuantities: {
          STORAGE_GB_HOURS: '200',
          API_CALL_COUNT: '50000',
          ACTIVE_USERS: '30',
        },
      });
      expect(results.length).toBe(3);
      expect(results.find((r) => r.meter === 'STORAGE_GB_HOURS')?.overageQuantity).toBe('100');
      expect(results.find((r) => r.meter === 'API_CALL_COUNT')?.overageQuantity).toBe('0');
      expect(results.find((r) => r.meter === 'ACTIVE_USERS')?.overageQuantity).toBe('5');
    });
  });
});