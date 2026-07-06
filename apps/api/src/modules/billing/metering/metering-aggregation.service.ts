/**
 * omyxia v2.0.0 P4.2 — MeteringAggregationService.
 *
 * Computes period totals from `TenantUsageDaily` rows. Three jobs:
 *
 *   1. **Daily backfill** (`recomputeTenantDay`) — recompute one
 *      (tenant, meter, day) row from raw events. Used by the nightly
 *      cron as a safety net.
 *
 *   2. **Monthly aggregation** (`aggregateMonthly`) — sum daily
 *      rollups for a tenant across one calendar month for each meter.
 *      The output is a `MonthlyMeterTotal[]` that the metering cron
 *      hands to `StripeMeteringService.pushUsageRecord`.
 *
 *   3. **List tenants due for a monthly report** (`listTenantsForReport`) —
 *      return every tenant that has any `TenantUsageDaily` row in the
 *      period. The monthly cron iterates this list.
 *
 * The service is *read-mostly*: it only writes back to `TenantUsageDaily`
 * (during recompute). It never writes to `TenantUsageEvent` or
 * `MeteredUsageReport`.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Tenant, UsageMeter, Prisma as PrismaTypes } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ALL_USAGE_METERS } from './metering.constants';
import { UsageCollectorService } from './usage-collector.service';
import { formatQuantity, sum, toNumber } from './decimal-math';
import type { DailyUsageRow, MonthlyMeterTotal } from './metering.types';

export interface MonthlyPeriod {
  /** ISO date (YYYY-MM-DD), inclusive first day of the period. */
  periodStart: string;
  /** ISO date (YYYY-MM-DD), inclusive last day of the period. */
  periodEnd: string;
}

export interface AggregateMonthlyOptions extends MonthlyPeriod {
  tenantIds?: string[];
  meters?: UsageMeter[];
}

@Injectable()
export class MeteringAggregationService {
  private readonly logger = new Logger(MeteringAggregationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: UsageCollectorService,
  ) {}

  // -------------------------------------------------------------------------
  // Daily backfill
  // -------------------------------------------------------------------------

  /**
   * Recompute one daily rollup from raw events. Called by the nightly
   * cron for the day-before-yesterday (we never recompute today because
   * events are still being written).
   */
  async recomputeTenantDay(params: {
    tenantId: string;
    meter: UsageMeter;
    usageDate: Date;
  }): Promise<DailyUsageRow> {
    return this.collector.recomputeDailyFromEvents(params);
  }

  /**
   * Recompute every (tenant, meter) pair for the given day. Returns
   * the number of rows written.
   */
  async recomputeAllForDay(usageDate: Date): Promise<number> {
    const dayStart = new Date(
      Date.UTC(usageDate.getUTCFullYear(), usageDate.getUTCMonth(), usageDate.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Find every (tenant, meter) pair that has an event in the day.
    const distinct = await this.prisma.tenantUsageEvent.findMany({
      where: { occurredAt: { gte: dayStart, lt: dayEnd } },
      select: { tenantId: true, meter: true },
      distinct: ['tenantId', 'meter'],
    });

    let written = 0;
    for (const row of distinct) {
      await this.recomputeTenantDay({
        tenantId: row.tenantId,
        meter: row.meter,
        usageDate: dayStart,
      });
      written += 1;
    }
    return written;
  }

  // -------------------------------------------------------------------------
  // Monthly aggregation
  // -------------------------------------------------------------------------

  /**
   * Compute monthly totals for one tenant across all meters.
   * Returns one `MonthlyMeterTotal` per meter (even if the meter has
   * no data — the caller decides whether to push a zero-quantity
   * usage record or skip).
   */
  async aggregateMonthlyForTenant(params: {
    tenantId: string;
    period: MonthlyPeriod;
    meters?: UsageMeter[];
  }): Promise<MonthlyMeterTotal[]> {
    const meters = params.meters ?? [...ALL_USAGE_METERS];
    const dayStart = new Date(`${params.period.periodStart}T00:00:00.000Z`);
    const dayEnd = new Date(`${params.period.periodEnd}T00:00:00.000Z`);

    const dailyRows = await this.prisma.tenantUsageDaily.findMany({
      where: {
        tenantId: params.tenantId,
        meter: { in: meters },
        usageDate: { gte: dayStart, lte: dayEnd },
      },
      select: { meter: true, quantity: true },
    });

    const totalsByMeter = new Map<UsageMeter, number>();
    for (const row of dailyRows) {
      totalsByMeter.set(row.meter, (totalsByMeter.get(row.meter) ?? 0) + toNumber(row.quantity));
    }

    return meters.map((meter) => ({
      tenantId: params.tenantId,
      meter,
      periodStart: params.period.periodStart,
      periodEnd: params.period.periodEnd,
      quantity: formatQuantity(totalsByMeter.get(meter) ?? 0),
    }));
  }

  /**
   * Aggregate monthly totals for many tenants in one call.
   * Returns a `Map<tenantId, MonthlyMeterTotal[]>`.
   */
  async aggregateMonthlyBulk(options: AggregateMonthlyOptions): Promise<Map<string, MonthlyMeterTotal[]>> {
    const dayStart = new Date(`${options.periodStart}T00:00:00.000Z`);
    const dayEnd = new Date(`${options.periodEnd}T00:00:00.000Z`);

    const where: PrismaTypes.TenantUsageDailyWhereInput | undefined = {
      tenantId: options.tenantIds ? { in: options.tenantIds } : undefined,
      meter: options.meters ? { in: options.meters } : undefined,
      usageDate: { gte: dayStart, lte: dayEnd },
    };

    const rows = await this.prisma.tenantUsageDaily.findMany({
      where,
      select: { tenantId: true, meter: true, quantity: true },
    });

    const totals = new Map<string, Map<UsageMeter, number>>();
    for (const row of rows) {
      let perMeter = totals.get(row.tenantId);
      if (!perMeter) {
        perMeter = new Map();
        totals.set(row.tenantId, perMeter);
      }
      perMeter.set(row.meter, (perMeter.get(row.meter) ?? 0) + toNumber(row.quantity));
    }

    const result = new Map<string, MonthlyMeterTotal[]>();
    const tenantIds = options.tenantIds ?? Array.from(totals.keys());
    const meters = options.meters ?? [...ALL_USAGE_METERS];
    for (const tenantId of tenantIds) {
      const perMeter = totals.get(tenantId);
      result.set(
        tenantId,
        meters.map((meter) => ({
          tenantId,
          meter,
          periodStart: options.periodStart,
          periodEnd: options.periodEnd,
          quantity: formatQuantity(perMeter?.get(meter) ?? 0),
        })),
      );
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Tenant listing
  // -------------------------------------------------------------------------

  /**
   * List tenants that have any usage data in the given period. Used by
   * the monthly cron to iterate report candidates.
   */
  async listTenantsForPeriod(period: MonthlyPeriod): Promise<Tenant[]> {
    const dayStart = new Date(`${period.periodStart}T00:00:00.000Z`);
    const dayEnd = new Date(`${period.periodEnd}T00:00:00.000Z`);

    const distinct = await this.prisma.tenantUsageDaily.findMany({
      where: { usageDate: { gte: dayStart, lte: dayEnd } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    const ids = distinct.map((r) => r.tenantId);
    if (ids.length === 0) return [];
    return this.prisma.tenant.findMany({ where: { id: { in: ids } } });
  }

  /**
   * List tenants that have a Stripe subscription (i.e. are eligible for
   * usage-record reporting). Used by the cron to skip tenants without
   * billing set up.
   */
  async listBillableTenantsForPeriod(period: MonthlyPeriod): Promise<Tenant[]> {
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

  // -------------------------------------------------------------------------
  // Period helpers
  // -------------------------------------------------------------------------

  /**
   * Compute the previous calendar month's start/end (UTC). Used by
   * the monthly cron to default the reporting period. We return the
   * previous month (not the current one) so we report on completed
   * billing cycles.
   */
  static previousCalendarMonth(reference: Date = new Date()): MonthlyPeriod {
    const year = reference.getUTCFullYear();
    const month = reference.getUTCMonth(); // 0-indexed
    const firstOfThisMonth = new Date(Date.UTC(year, month, 1));
    const firstOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
    const prevYear = firstOfPrevMonth.getUTCFullYear();
    const prevMonth = firstOfPrevMonth.getUTCMonth();
    const lastDayOfPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return {
      periodStart: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`,
      periodEnd: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(lastDayOfPrevMonth).padStart(2, '0')}`,
    };
  }

  /**
   * Compute the previous-day range for the daily cron backfill.
   */
  static previousDay(reference: Date = new Date()): { usageDate: Date } {
    const dayStart = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
    );
    const previous = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
    return { usageDate: previous };
  }

  /**
   * Sum the totals across all meters for a single tenant (used in
   * logs + admin views).
   */
  static summarise(totals: ReadonlyArray<MonthlyMeterTotal>): number {
    return sum(totals.map((t) => t.quantity));
  }
}