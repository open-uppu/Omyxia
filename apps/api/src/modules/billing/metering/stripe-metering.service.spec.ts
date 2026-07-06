/**
 * omyxia v2.0.0 P4.2 — StripeMeteringService tests.
 *
 * Drives the metering service with a stub Prisma + a stub StripeService
 * (we don't mock the Stripe SDK; the service wrapper is the boundary).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeMeteringService } from './stripe-metering.service';
import {
  meteredSubscriptionItemRecord,
  stripeCustomerRecord,
  stripeSubscriptionItemRecord,
  stripeSubscriptionRecord,
} from './__fixtures__/metering.fixtures';

interface ReportRow {
  id: string;
  tenantId: string;
  meter: string;
  periodStart: Date;
  periodEnd: Date;
  quantity: string;
  status: string;
  errorMessage: string | null;
  stripeUsageRecordId: string | null;
  stripeSubscriptionItemId: string | null;
  attempts: number;
  reportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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

function mkPrismaStub(opts: {
  customer?: any;
  subscription?: any;
  item?: any;
  metered?: any;
} = {}) {
  const reports: ReportRow[] = [];
  const overages: OverageRow[] = [];
  let reportCounter = 0;
  let overageCounter = 0;

  return {
    prisma: {
      stripeCustomer: {
        findUnique: vi.fn(async (args: { where: { tenantId: string } }) => {
          if (opts.customer && opts.customer.tenantId === args.where.tenantId) return opts.customer;
          return null;
        }),
      },
      stripeSubscription: {
        findUnique: vi.fn(async () => {
          if (!opts.subscription) return null;
          return {
            ...opts.subscription,
            items: opts.item ? [{ ...opts.item, metered: opts.metered ?? null }] : [],
          };
        }),
      },
      meteredUsageReport: {
        upsert: vi.fn(async (args: { where: any; create: any; update: any }) => {
          const existing = reports.find(
            (r) =>
              r.tenantId === args.where.tenantId_meter_periodStart.tenantId &&
              r.meter === args.where.tenantId_meter_periodStart.meter &&
              r.periodStart.getTime() === args.where.tenantId_meter_periodStart.periodStart.getTime(),
          );
          if (existing) {
            Object.assign(existing, args.update, {
              attempts: existing.attempts + (args.update.attempts?.increment ?? args.create.attempts ?? 0),
            });
            return existing;
          }
          reportCounter += 1;
          const now = new Date();
          const row: ReportRow = {
            id: `report-${reportCounter}`,
            createdAt: now,
            updatedAt: now,
            ...args.create,
          };
          reports.push(row);
          return row;
        }),
        findMany: vi.fn(async (args: { where?: any; orderBy?: any; take?: number } = {}) => {
          let rows = reports;
          if (args.where?.tenantId) rows = rows.filter((r) => r.tenantId === args.where.tenantId);
          if (args.where?.periodStart) rows = rows.filter((r) => r.periodStart.getTime() === args.where.periodStart.getTime());
          if (args.where?.status) rows = rows.filter((r) => r.status === args.where.status);
          if (args.where?.attempts?.lt !== undefined) rows = rows.filter((r) => r.attempts < args.where.attempts.lt);
          return rows.slice(0, args.take ?? rows.length);
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
      },
    } as any,
    state: { reports, overages },
  };
}

function mkStripeStub(opts: { ok?: boolean; fail?: Error } = {}) {
  return {
    createUsageRecord: vi.fn(async () => {
      if (opts.fail) throw opts.fail;
      return { stripeUsageRecordId: 'mbur_test_xyz', livemode: false };
    }),
    createInvoiceItem: vi.fn(async () => {
      if (opts.fail) throw opts.fail;
      return { stripeInvoiceItemId: 'ii_test_xyz', livemode: false };
    }),
    getStripeCustomerIdForTenant: vi.fn(async (tenantId: string) => {
      return tenantId === 'tenant-1' ? 'cus_test_tenant1' : null;
    }),
  } as any;
}

describe('StripeMeteringService', () => {
  let stub: ReturnType<typeof mkPrismaStub>;
  let stripe: ReturnType<typeof mkStripeStub>;

  beforeEach(() => {
    stub = mkPrismaStub();
    stripe = mkStripeStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pushUsageRecord', () => {
    it('resolves the subscription item and pushes to Stripe', async () => {
      stub = mkPrismaStub({
        subscription: stripeSubscriptionRecord(),
        item: stripeSubscriptionItemRecord(),
        metered: meteredSubscriptionItemRecord(),
      });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.pushUsageRecord({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        quantity: '500',
      });

      expect(result.pushed).toBe(true);
      expect(result.report.status).toBe('SYNCED');
      expect(result.report.stripeUsageRecordId).toBe('mbur_test_xyz');
      expect(stripe.createUsageRecord).toHaveBeenCalledOnce();
    });

    it('marks FAILED when no subscription item matches', async () => {
      stub = mkPrismaStub({
        subscription: stripeSubscriptionRecord(),
        item: stripeSubscriptionItemRecord(),
        metered: meteredSubscriptionItemRecord({ meter: 'API_CALL_COUNT' }),
      });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.pushUsageRecord({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        quantity: '500',
      });

      expect(result.pushed).toBe(false);
      expect(result.report.status).toBe('FAILED');
      expect(result.report.errorMessage).toContain('no metered subscription item');
    });

    it('marks FAILED on Stripe API error', async () => {
      stub = mkPrismaStub({
        subscription: stripeSubscriptionRecord(),
        item: stripeSubscriptionItemRecord(),
        metered: meteredSubscriptionItemRecord(),
      });
      stripe = mkStripeStub({ fail: new Error('Stripe unavailable') });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.pushUsageRecord({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        quantity: '500',
      });

      expect(result.pushed).toBe(false);
      expect(result.report.status).toBe('FAILED');
      expect(result.report.errorMessage).toBe('Stripe unavailable');
      expect(result.report.attempts).toBe(1);
    });

    it('returns FAILED when tenant has no subscription', async () => {
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.pushUsageRecord({
        tenantId: 'tenant-x',
        meter: 'API_CALL_COUNT',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        quantity: '100',
      });

      expect(result.pushed).toBe(false);
      expect(result.report.status).toBe('FAILED');
    });
  });

  describe('pushOverageInvoiceItem', () => {
    it('creates an invoice item on Stripe', async () => {
      stub = mkPrismaStub({ customer: stripeCustomerRecord() });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const row = await svc.pushOverageInvoiceItem({
        tenantId: 'tenant-1',
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        includedQuantity: '100',
        actualQuantity: '150',
        overageQuantity: '50',
        unitPrice: '0.1',
        amount: '5',
        currency: 'usd',
        description: 'Overage',
      });

      expect(row.status).toBe('INVOICED');
      expect(row.stripeInvoiceItemId).toBe('ii_test_xyz');
      expect(stripe.createInvoiceItem).toHaveBeenCalledOnce();
    });

    it('marks FAILED when no Stripe customer', async () => {
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const row = await svc.pushOverageInvoiceItem({
        tenantId: 'tenant-x',
        meter: 'API_CALL_COUNT',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        includedQuantity: '100000',
        actualQuantity: '120000',
        overageQuantity: '20000',
        unitPrice: '0.001',
        amount: '20',
        currency: 'usd',
        description: 'Overage',
      });

      expect(row.status).toBe('FAILED');
      expect(row.errorMessage).toContain('no Stripe customer');
    });

    it('marks FAILED on Stripe API error', async () => {
      stub = mkPrismaStub({ customer: stripeCustomerRecord() });
      stripe = mkStripeStub({ fail: new Error('Stripe error') });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const row = await svc.pushOverageInvoiceItem({
        tenantId: 'tenant-1',
        meter: 'API_CALL_COUNT',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        includedQuantity: '100000',
        actualQuantity: '120000',
        overageQuantity: '20000',
        unitPrice: '0.001',
        amount: '20',
        currency: 'usd',
        description: 'Overage',
      });

      expect(row.status).toBe('FAILED');
      expect(row.errorMessage).toBe('Stripe error');
    });
  });

  describe('formatOverageDescription', () => {
    it('produces a human-readable invoice line', () => {
      const desc = StripeMeteringService.formatOverageDescription({
        meter: 'STORAGE_GB_HOURS',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        overageQuantity: '50',
        unit: 'GB-hour',
      });
      expect(desc).toContain('storage gb hours');
      expect(desc).toContain('50 GB-hour');
      expect(desc).toContain('2026-06-01');
    });
  });

  describe('resolveSubscriptionItemForMeter', () => {
    it('returns null when tenant has no subscription', async () => {
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.resolveSubscriptionItemForMeter('tenant-x', 'API_CALL_COUNT');
      expect(result).toBeNull();
    });

    it('returns null when subscription has no metered item for the meter', async () => {
      stub = mkPrismaStub({
        subscription: stripeSubscriptionRecord(),
        item: stripeSubscriptionItemRecord(),
        metered: meteredSubscriptionItemRecord({ meter: 'API_CALL_COUNT' }),
      });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.resolveSubscriptionItemForMeter('tenant-1', 'STORAGE_GB_HOURS');
      expect(result).toBeNull();
    });

    it('returns the local Stripe item id when stripeSubscriptionItemId is null', async () => {
      stub = mkPrismaStub({
        subscription: stripeSubscriptionRecord(),
        item: stripeSubscriptionItemRecord({ stripeSubscriptionItemId: 'si_local_1' }),
        metered: meteredSubscriptionItemRecord({ stripeSubscriptionItemId: null }),
      });
      const svc = new StripeMeteringService(stub.prisma, stripe);
      const result = await svc.resolveSubscriptionItemForMeter('tenant-1', 'STORAGE_GB_HOURS');
      expect(result?.stripeSubscriptionItemId).toBe('si_local_1');
    });
  });
});