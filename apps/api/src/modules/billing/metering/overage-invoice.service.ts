/**
 * omyxia v2.0.0 P4.2 — OverageInvoiceService.
 *
 * Computes overage charges and pushes them to Stripe as invoice items.
 *
 * The overage rule is:
 *   * Each `PlanUsageQuota` row declares `includedQuantity` and
 *     `unitPrice` for each of the three meters.
 *   * If `actualQuantity > includedQuantity`, the overage is
 *     `(actualQuantity - includedQuantity) * unitPrice` (floored at
 *     zero).
 *   * If `unitPrice` is null, no overage is billed — the plan's pricing
 *     is "uncapped" (e.g. ENTERPRISE contracts).
 *
 * The service is driven by the monthly cron, but it can also be called
 * on-demand from the admin endpoint to preview a charge before sending
 * it.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Tenant, UsageMeter } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StripeMeteringService } from './stripe-metering.service';
import {
  DEFAULT_OVERAGE_CURRENCY,
  USAGE_METER_UNITS,
} from './metering.constants';
import { formatMoney, formatQuantity, overageOf, toNumber } from './decimal-math';
import type { OverageInvoicingResult, OverageRow } from './metering.types';

export interface ComputeOverageInput {
  tenantId: string;
  meter: UsageMeter;
  periodStart: string;
  periodEnd: string;
  actualQuantity: string;
  planId: string | null;
}

export interface ComputeOverageResult {
  meter: UsageMeter;
  includedQuantity: string;
  actualQuantity: string;
  overageQuantity: string;
  unitPrice: string | null;
  amount: string | null;
  /** True when the plan has a unit price AND there's an overage. */
  billable: boolean;
  reason: string;
}

@Injectable()
export class OverageInvoiceService {
  private readonly logger = new Logger(OverageInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeMeteringService,
  ) {}

  // -------------------------------------------------------------------------
  // Compute (read-only)
  // -------------------------------------------------------------------------

  /**
   * Compute the overage charge for a single (tenant, meter, period)
   * combination without writing anything. Used by the admin preview
   * endpoint.
   */
  async computeOverage(input: ComputeOverageInput): Promise<ComputeOverageResult> {
    const quota = await this.getQuotaForMeter(input.tenantId, input.meter, input.planId);
    if (!quota) {
      return {
        meter: input.meter,
        includedQuantity: '0',
        actualQuantity: formatQuantity(input.actualQuantity),
        overageQuantity: '0',
        unitPrice: null,
        amount: null,
        billable: false,
        reason: 'no plan quota configured',
      };
    }

    const overageQty = overageOf(input.actualQuantity, quota.includedQuantity);
    const unitPrice = quota.unitPrice;

    if (overageQty === 0) {
      return {
        meter: input.meter,
        includedQuantity: formatQuantity(quota.includedQuantity),
        actualQuantity: formatQuantity(input.actualQuantity),
        overageQuantity: '0',
        unitPrice: unitPrice !== null ? formatQuantity(unitPrice) : null,
        amount: '0',
        billable: false,
        reason: 'within included quota',
      };
    }

    if (unitPrice === null) {
      return {
        meter: input.meter,
        includedQuantity: formatQuantity(quota.includedQuantity),
        actualQuantity: formatQuantity(input.actualQuantity),
        overageQuantity: formatQuantity(overageQty),
        unitPrice: null,
        amount: null,
        billable: false,
        reason: 'overage but no unit price configured',
      };
    }

    const amount = formatMoney(overageQty * toNumber(unitPrice));
    return {
      meter: input.meter,
      includedQuantity: formatQuantity(quota.includedQuantity),
      actualQuantity: formatQuantity(input.actualQuantity),
      overageQuantity: formatQuantity(overageQty),
      unitPrice: formatQuantity(unitPrice),
      amount,
      billable: true,
      reason: 'overage above included quota',
    };
  }

  /**
   * Compute the overage charge for all meters of a tenant in one call.
   */
  async computeOverageForTenant(input: {
    tenantId: string;
    periodStart: string;
    periodEnd: string;
    actualQuantities: Record<UsageMeter, string>;
    planId: string | null;
  }): Promise<ComputeOverageResult[]> {
    const meters: UsageMeter[] = ['STORAGE_GB_HOURS', 'API_CALL_COUNT', 'ACTIVE_USERS'];
    const results: ComputeOverageResult[] = [];
    for (const meter of meters) {
      results.push(
        await this.computeOverage({
          tenantId: input.tenantId,
          meter,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          actualQuantity: input.actualQuantities[meter] ?? '0',
          planId: input.planId,
        }),
      );
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Invoice (write to Stripe)
  // -------------------------------------------------------------------------

  /**
   * Push the overage invoice items for one tenant across all meters.
   * Idempotent on `(tenantId, meter, periodStart)`.
   */
  async invoiceOverageForTenant(input: {
    tenantId: string;
    planId: string | null;
    periodStart: string;
    periodEnd: string;
    actualQuantities: Record<UsageMeter, string>;
  }): Promise<OverageInvoicingResult> {
    const computations = await this.computeOverageForTenant({
      tenantId: input.tenantId,
      planId: input.planId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      actualQuantities: input.actualQuantities,
    });

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let totalAmount = 0;
    const invoiceItemIds: Record<UsageMeter, string | null> = {
      STORAGE_GB_HOURS: null,
      API_CALL_COUNT: null,
      ACTIVE_USERS: null,
    };
    const errors: Partial<Record<UsageMeter, string>> = {};

    for (const c of computations) {
      if (!c.billable || c.amount === null) {
        skipped += 1;
        continue;
      }
      const row = await this.stripe.pushOverageInvoiceItem({
        tenantId: input.tenantId,
        meter: c.meter,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        includedQuantity: c.includedQuantity,
        actualQuantity: c.actualQuantity,
        overageQuantity: c.overageQuantity,
        unitPrice: c.unitPrice ?? '0',
        amount: c.amount,
        currency: DEFAULT_OVERAGE_CURRENCY,
        description: StripeMeteringService.formatOverageDescription({
          meter: c.meter,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          overageQuantity: c.overageQuantity,
          unit: USAGE_METER_UNITS[c.meter],
        }),
      });

      if (row.status === 'INVOICED') {
        succeeded += 1;
        invoiceItemIds[c.meter] = row.stripeInvoiceItemId;
        totalAmount += toNumber(row.amount);
      } else {
        failed += 1;
        errors[c.meter] = row.errorMessage ?? 'unknown error';
      }
    }

    return {
      tenantId: input.tenantId,
      totalOverageItems: computations.filter((c) => c.billable).length,
      succeeded,
      failed,
      skipped,
      invoiceItemIds,
      totalAmount: formatMoney(totalAmount),
      errors,
    };
  }

  /**
   * Iterate every billable tenant for the period and invoice their
   * overages. Used by the monthly cron.
   */
  async invoiceAllOverageForPeriod(period: {
    periodStart: string;
    periodEnd: string;
  }): Promise<OverageInvoicingResult[]> {
    const tenants = await this.listBillableTenantsForOverage(period);
    const results: OverageInvoicingResult[] = [];

    for (const tenant of tenants) {
      try {
        const actualQuantities = await this.aggregateActualQuantities(
          tenant.id,
          period,
        );
        const planId = await this.resolvePlanIdForTenant(tenant);
        const result = await this.invoiceOverageForTenant({
          tenantId: tenant.id,
          planId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          actualQuantities,
        });
        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(
          `invoiceAllOverageForPeriod: tenant=${tenant.id} error=${message}`,
        );
        results.push({
          tenantId: tenant.id,
          totalOverageItems: 0,
          succeeded: 0,
          failed: 1,
          skipped: 0,
          invoiceItemIds: {
            STORAGE_GB_HOURS: null,
            API_CALL_COUNT: null,
            ACTIVE_USERS: null,
          },
          totalAmount: '0',
          errors: { ACTIVE_USERS: message },
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async listOverageForTenant(input: {
    tenantId: string;
    periodStart?: string;
  }): Promise<OverageRow[]> {
    const rows = await this.prisma.overageInvoiceItem.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.periodStart
          ? { periodStart: new Date(`${input.periodStart}T00:00:00.000Z`) }
          : {}),
      },
      orderBy: [{ periodStart: 'desc' }, { meter: 'asc' }],
    });
    return rows.map((r) => this.toOverageRow(r));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async getQuotaForMeter(
    tenantId: string,
    meter: UsageMeter,
    planId: string | null,
  ): Promise<{
    includedQuantity: string;
    unitPrice: string | null;
  } | null> {
    if (!planId) {
      // No plan → no overage billable. (LEGACY_FULL_ACCESS plans are
      // explicitly exempt; they're billed at the legacy flat fee.)
      return null;
    }
    const quota = await this.prisma.planUsageQuota.findUnique({
      where: { planId },
    });
    if (!quota) return null;

    const { included, unitPrice } = this.extractMeterFields(quota, meter);
    if (included === null) {
      // Meter is "unlimited" on this plan.
      return null;
    }
    return { includedQuantity: included, unitPrice };
  }

  private extractMeterFields(
    quota: {
      storageGb: { toString(): string } | null;
      apiCalls: number | null;
      activeUsers: number | null;
      storageOveragePrice: { toString(): string } | null;
      apiCallOveragePrice: { toString(): string } | null;
      activeUserOveragePrice: { toString(): string } | null;
    },
    meter: UsageMeter,
  ): { included: string | null; unitPrice: string | null } {
    switch (meter) {
      case 'STORAGE_GB_HOURS':
        return {
          included: quota.storageGb?.toString() ?? null,
          unitPrice: quota.storageOveragePrice?.toString() ?? null,
        };
      case 'API_CALL_COUNT':
        return {
          included: quota.apiCalls === null ? null : String(quota.apiCalls),
          unitPrice: quota.apiCallOveragePrice?.toString() ?? null,
        };
      case 'ACTIVE_USERS':
        return {
          included: quota.activeUsers === null ? null : String(quota.activeUsers),
          unitPrice: quota.activeUserOveragePrice?.toString() ?? null,
        };
      default:
        return { included: null, unitPrice: null };
    }
  }

  private async listBillableTenantsForOverage(period: {
    periodStart: string;
    periodEnd: string;
  }): Promise<Tenant[]> {
    const dayStart = new Date(`${period.periodStart}T00:00:00.000Z`);
    const dayEnd = new Date(`${period.periodEnd}T00:00:00.000Z`);

    const rows = await this.prisma.tenantUsageDaily.findMany({
      where: { usageDate: { gte: dayStart, lte: dayEnd } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    const ids = rows.map((r) => r.tenantId);
    if (ids.length === 0) return [];

    return this.prisma.tenant.findMany({
      where: {
        id: { in: ids },
        stripeCustomer: { isNot: null },
      },
    });
  }

  private async aggregateActualQuantities(
    tenantId: string,
    period: { periodStart: string; periodEnd: string },
  ): Promise<Record<UsageMeter, string>> {
    const dayStart = new Date(`${period.periodStart}T00:00:00.000Z`);
    const dayEnd = new Date(`${period.periodEnd}T00:00:00.000Z`);

    const rows = await this.prisma.tenantUsageDaily.findMany({
      where: {
        tenantId,
        usageDate: { gte: dayStart, lte: dayEnd },
      },
      select: { meter: true, quantity: true },
    });

    const totals: Record<UsageMeter, number> = {
      STORAGE_GB_HOURS: 0,
      API_CALL_COUNT: 0,
      ACTIVE_USERS: 0,
    };
    for (const row of rows) {
      totals[row.meter] = (totals[row.meter] ?? 0) + toNumber(row.quantity);
    }

    return {
      STORAGE_GB_HOURS: formatQuantity(totals.STORAGE_GB_HOURS),
      API_CALL_COUNT: formatQuantity(totals.API_CALL_COUNT),
      ACTIVE_USERS: formatQuantity(totals.ACTIVE_USERS),
    };
  }

  /**
   * Resolve the current `Plan.id` for a tenant via the latest
   * `TenantEntitlement` row. Returns null when the tenant has no
   * entitlement yet (e.g. mid-onboarding).
   */
  private async resolvePlanIdForTenant(tenant: Tenant): Promise<string | null> {
    const entitlement = await this.prisma.tenantEntitlement.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { effectiveAt: 'desc' },
      select: { planId: true, expiresAt: true },
    });
    if (!entitlement) return null;
    if (entitlement.expiresAt && entitlement.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return entitlement.planId;
  }

  private toOverageRow(row: {
    id: string;
    tenantId: string;
    meter: UsageMeter;
    periodStart: Date;
    periodEnd: Date;
    includedQuantity: { toString(): string };
    actualQuantity: { toString(): string };
    overageQuantity: { toString(): string };
    unitPrice: { toString(): string };
    amount: { toString(): string };
    currency: string;
    stripeInvoiceItemId: string | null;
    stripeInvoiceId: string | null;
    status: OverageRow['status'];
    errorMessage: string | null;
    attempts: number;
    invoicedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): OverageRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      meter: row.meter,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      includedQuantity: formatQuantity(row.includedQuantity.toString()),
      actualQuantity: formatQuantity(row.actualQuantity.toString()),
      overageQuantity: formatQuantity(row.overageQuantity.toString()),
      unitPrice: formatQuantity(row.unitPrice.toString()),
      amount: formatMoney(row.amount.toString()),
      currency: row.currency,
      stripeInvoiceItemId: row.stripeInvoiceItemId,
      stripeInvoiceId: row.stripeInvoiceId,
      status: row.status,
      errorMessage: row.errorMessage,
      attempts: row.attempts,
      invoicedAt: row.invoicedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}