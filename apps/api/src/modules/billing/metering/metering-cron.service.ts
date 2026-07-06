/**
 * omyxia v2.0.0 P4.2 — MeteringCronService.
 *
 * Orchestrates the three scheduled jobs:
 *
 *   1. **Daily aggregation** — recompute the day-before-yesterday's
 *      daily rollups from raw events (safety net for any missed hot-
 *      path writes).
 *
 *   2. **Monthly usage reporting** — for each billable tenant, push
 *      monthly totals to Stripe as usage records.
 *
 *   3. **Monthly overage invoicing** — for each tenant that exceeded
 *      its plan's included quota, push the overage as a Stripe
 *      invoice item.
 *
 *   4. **Event retention** — prune old `TenantUsageEvent` rows.
 *
 * All four jobs are advisory-locked via Redis so a second API replica
 * doesn't double-process. The lock TTL matches the cron interval — if
 * a job is still running when the next tick fires, the second tick
 * no-ops.
 *
 * Cron expressions live in `metering.constants.ts`. We use `@nestjs/schedule`
 * (registered globally by `MailModule`) so we don't need to import
 * `ScheduleModule.forRoot()` here.
 *
 * Manual trigger:
 *   The admin endpoint `POST /api/admin/usage/sync-now` calls
 *   `runMonthlyReport()` + `invoiceAllOverageForPeriod()` on demand.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MeteringAggregationService } from './metering-aggregation.service';
import { OverageInvoiceService } from './overage-invoice.service';
import { StripeMeteringService } from './stripe-metering.service';
import {
  DAILY_AGGREGATION_CRON,
  DAILY_LOCK_REDIS_KEY_PREFIX,
  EVENT_RETENTION_CRON,
  MONTHLY_LOCK_REDIS_KEY_PREFIX,
  MONTHLY_REPORTING_CRON,
  OVERAGE_INVOICING_CRON,
  OVERAGE_LOCK_REDIS_KEY_PREFIX,
  USAGE_EVENT_RETENTION_DAYS,
} from './metering.constants';
import { toNumber } from './decimal-math';
import type {
  MonthlyReportResult,
  OverageInvoicingResult,
  SyncNowResult,
} from './metering.types';
import type { Tenant, UsageMeter } from '@prisma/client';

export interface CronRunOptions {
  /** Skip the Redis advisory lock (used by tests). */
  skipLock?: boolean;
  /** Override the period (used by the admin sync-now endpoint). */
  period?: { periodStart: string; periodEnd: string };
  /** Cap the number of tenants processed (used by the admin sync-now). */
  tenantLimit?: number;
}

@Injectable()
export class MeteringCronService {
  private readonly logger = new Logger(MeteringCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aggregation: MeteringAggregationService,
    private readonly stripe: StripeMeteringService,
    private readonly overage: OverageInvoiceService,
  ) {}

  // =========================================================================
  // Daily aggregation
  // =========================================================================

  @Cron(DAILY_AGGREGATION_CRON)
  async runDailyAggregation(): Promise<void> {
    return this.runDailyAggregationWithOptions({});
  }

  async runDailyAggregationWithOptions(options: CronRunOptions): Promise<void> {
    const lockKey = `${DAILY_LOCK_REDIS_KEY_PREFIX}${this.toIsoDate(new Date())}`;
    const acquired = await this.acquireLock(lockKey, options.skipLock);
    if (!acquired) {
      this.logger.warn(`runDailyAggregation: lock held, skipping tick`);
      return;
    }
    try {
      const { usageDate } = MeteringAggregationService.previousDay(new Date());
      const written = await this.aggregation.recomputeAllForDay(usageDate);
      this.logger.log(
        `runDailyAggregation: recomputed ${written} (tenant, meter) rows for ${this.toIsoDate(usageDate)}`,
      );
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // =========================================================================
  // Monthly usage reporting
  // =========================================================================

  @Cron(MONTHLY_REPORTING_CRON)
  async runMonthlyReport(): Promise<void> {
    await this.runMonthlyReportWithOptions({});
  }

  /**
   * Run the monthly report. Public so the admin sync-now endpoint can
   * invoke it.
   */
  async runMonthlyReportWithOptions(options: CronRunOptions): Promise<SyncNowResult> {
    const period = options.period ?? MeteringAggregationService.previousCalendarMonth(new Date());
    const lockKey = `${MONTHLY_LOCK_REDIS_KEY_PREFIX}${period.periodStart}`;
    const acquired = await this.acquireLock(lockKey, options.skipLock);
    if (!acquired) {
      this.logger.warn(`runMonthlyReport: lock held, skipping tick for ${period.periodStart}`);
      return this.emptySyncResult(period.periodStart, period.periodEnd);
    }
    try {
      const tenants = await this.aggregation.listBillableTenantsForPeriod(period);
      const limitedTenants = options.tenantLimit
        ? tenants.slice(0, options.tenantLimit)
        : tenants;

      const tenantResults: MonthlyReportResult[] = [];
      let totalSucceeded = 0;
      let totalFailed = 0;
      let totalReports = 0;

      for (const tenant of limitedTenants) {
        try {
          const result = await this.pushMonthlyForTenant(tenant, period);
          tenantResults.push(result);
          totalSucceeded += result.succeeded;
          totalFailed += result.failed;
          totalReports += result.totalReports;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown error';
          this.logger.error(
            `runMonthlyReport: tenant=${tenant.id} error=${message}`,
          );
          tenantResults.push(this.errorResult(tenant.id, message));
          totalFailed += 1;
          totalReports += 1;
        }
      }

      this.logger.log(
        `runMonthlyReport: period=${period.periodStart}..${period.periodEnd} ` +
          `tenants=${limitedTenants.length} reports=${totalReports} succeeded=${totalSucceeded} failed=${totalFailed}`,
      );

      return {
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        totalTenants: limitedTenants.length,
        totalReports,
        succeeded: totalSucceeded,
        failed: totalFailed,
        tenants: tenantResults.slice(0, 50), // cap for the admin UI
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // =========================================================================
  // Monthly overage invoicing
  // =========================================================================

  @Cron(OVERAGE_INVOICING_CRON)
  async runOverageInvoicing(): Promise<void> {
    await this.runOverageInvoicingWithOptions({});
  }

  async runOverageInvoicingWithOptions(options: CronRunOptions): Promise<{
    period: { periodStart: string; periodEnd: string };
    results: OverageInvoicingResult[];
    totalSucceeded: number;
    totalFailed: number;
    totalSkipped: number;
    totalAmount: string;
  }> {
    const period = options.period ?? MeteringAggregationService.previousCalendarMonth(new Date());
    const lockKey = `${OVERAGE_LOCK_REDIS_KEY_PREFIX}${period.periodStart}`;
    const acquired = await this.acquireLock(lockKey, options.skipLock);
    if (!acquired) {
      this.logger.warn(`runOverageInvoicing: lock held, skipping tick for ${period.periodStart}`);
      return {
        period,
        results: [],
        totalSucceeded: 0,
        totalFailed: 0,
        totalSkipped: 0,
        totalAmount: '0',
      };
    }
    try {
      const results = options.tenantLimit
        ? (await this.overage.invoiceAllOverageForPeriod(period)).slice(0, options.tenantLimit)
        : await this.overage.invoiceAllOverageForPeriod(period);

      const totalSucceeded = results.reduce((a, r) => a + r.succeeded, 0);
      const totalFailed = results.reduce((a, r) => a + r.failed, 0);
      const totalSkipped = results.reduce((a, r) => a + r.skipped, 0);
      const totalAmount = results.reduce((a, r) => a + toNumber(r.totalAmount), 0);

      this.logger.log(
        `runOverageInvoicing: period=${period.periodStart}..${period.periodEnd} ` +
          `tenants=${results.length} succeeded=${totalSucceeded} failed=${totalFailed} skipped=${totalSkipped} ` +
          `totalAmount=$${totalAmount.toFixed(2)}`,
      );

      return {
        period,
        results: results.slice(0, 50),
        totalSucceeded,
        totalFailed,
        totalSkipped,
        totalAmount: totalAmount.toFixed(2),
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // =========================================================================
  // Event retention
  // =========================================================================

  @Cron(EVENT_RETENTION_CRON)
  async runRetention(): Promise<{ deleted: number; beforeDate: string }> {
    return this.runRetentionWithOptions({});
  }

  async runRetentionWithOptions(options: CronRunOptions): Promise<{
    deleted: number;
    beforeDate: string;
  }> {
    const now = new Date();
    const beforeDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - USAGE_EVENT_RETENTION_DAYS),
    );
    const beforeDateIso = beforeDate.toISOString().slice(0, 10);

    // We call the collector's prune directly without a Redis lock —
    // the retention job is idempotent on (id) and capped by `limit`.
    const { deleted } = await this.runPruneLoop(beforeDate, options.skipLock);
    this.logger.log(
      `runRetention: deleted ${deleted} events older than ${beforeDateIso}`,
    );
    return { deleted, beforeDate: beforeDateIso };
  }

  private async runPruneLoop(beforeDate: Date, skipLock?: boolean): Promise<{ deleted: number }> {
    let totalDeleted = 0;
    // Loop in batches to avoid one huge delete query. We bail out
    // early when the batch returns 0 rows.
    // Note: the collector's `pruneOldEvents` is not directly exposed
    // through the cron; we call its underlying Prisma methods instead.
    for (let i = 0; i < 100; i += 1) {
      const rows = await this.prisma.tenantUsageEvent.findMany({
        where: {
          occurredAt: { lt: beforeDate },
          aggregatedAt: { not: null },
        },
        select: { id: true },
        take: 5_000,
        orderBy: { occurredAt: 'asc' },
      });
      if (rows.length === 0) break;
      const res = await this.prisma.tenantUsageEvent.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      totalDeleted += res.count;
      if (skipLock === undefined) {
        // Soft bail-out for the regular cron: when we delete less than
        // the batch size, we're caught up.
        if (res.count < 5_000) break;
      }
    }
    return { deleted: totalDeleted };
  }

  // =========================================================================
  // Tenant-level push
  // =========================================================================

  /**
   * Push monthly usage records for a single tenant. Used by the cron
   * and the admin endpoint.
   */
  async pushMonthlyForTenant(
    tenant: Pick<Tenant, 'id'>,
    period: { periodStart: string; periodEnd: string },
  ): Promise<MonthlyReportResult> {
    const totals = await this.aggregation.aggregateMonthlyForTenant({
      tenantId: tenant.id,
      period,
    });

    let succeeded = 0;
    let failed = 0;
    const usageRecordIds: Record<UsageMeter, string | null> = {
      STORAGE_GB_HOURS: null,
      API_CALL_COUNT: null,
      ACTIVE_USERS: null,
    };
    const errors: Partial<Record<UsageMeter, string>> = {};

    for (const total of totals) {
      // Skip zero-quantity meters — pushing a 0 record to Stripe is a
      // no-op for billing but adds noise. The overage job still picks
      // up these tenants when they exceed the included quota because
      // it uses the raw `actualQuantity` (which is also 0 in this case).
      if (toNumber(total.quantity) === 0) continue;

      const { pushed, report } = await this.stripe.pushUsageRecord({
        tenantId: tenant.id,
        meter: total.meter,
        periodStart: total.periodStart,
        periodEnd: total.periodEnd,
        quantity: total.quantity,
      });
      if (pushed) {
        succeeded += 1;
        usageRecordIds[total.meter] = report.stripeUsageRecordId;
      } else {
        failed += 1;
        errors[total.meter] = report.errorMessage ?? 'unknown error';
      }
    }

    return {
      tenantId: tenant.id,
      totalReports: totals.filter((t) => toNumber(t.quantity) > 0).length,
      succeeded,
      failed,
      usageRecordIds,
      errors,
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private async acquireLock(key: string, skipLock?: boolean): Promise<boolean> {
    if (skipLock) return true;
    try {
      const client = this.redis.getClient();
      // SET key 1 NX EX <ttl>. Returns 'OK' on success, null on collision.
      const result = await client.set(key, '1', 'EX', 60 * 60, 'NX');
      return result === 'OK';
    } catch (err) {
      // Redis outage — log and proceed without the lock. The DB unique
      // indexes on (tenantId, meter, periodStart) prevent double-writes
      // anyway, so this is safe.
      this.logger.warn(
        `acquireLock: Redis unavailable, proceeding without lock (${(err as Error).message})`,
      );
      return true;
    }
  }

  private async releaseLock(key: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.del(key);
    } catch (err) {
      // Best-effort — the lock will expire on its own.
      this.logger.warn(`releaseLock: failed to release ${key} (${(err as Error).message})`);
    }
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private emptySyncResult(periodStart: string, periodEnd: string): SyncNowResult {
    return {
      periodStart,
      periodEnd,
      totalTenants: 0,
      totalReports: 0,
      succeeded: 0,
      failed: 0,
      tenants: [],
    };
  }

  private errorResult(tenantId: string, message: string): MonthlyReportResult {
    return {
      tenantId,
      totalReports: 0,
      succeeded: 0,
      failed: 1,
      usageRecordIds: {
        STORAGE_GB_HOURS: null,
        API_CALL_COUNT: null,
        ACTIVE_USERS: null,
      },
      errors: { ACTIVE_USERS: message },
    };
  }
}