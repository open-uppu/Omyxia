/**
 * omyxia v2.0.0 P4.2 — StripeMeteringService.
 *
 * Bridges the metering module to the Stripe Billing API. Two jobs:
 *
 *   1. **Push usage records** for the previous billing period so Stripe
 *      can bill the metered subscription item (`storage_gb_hours`,
 *      `api_call_count`, `active_users`). Wraps
 *      `StripeService.createUsageRecord(...)` so we have a single
 *      point of failure for retry/error handling.
 *
 *   2. **Append overage invoice items** for tenants that consumed more
 *      than the included quota. Wraps
 *      `StripeService.createInvoiceItem(...)`. The invoice item shows
 *      up on the customer's next Stripe-generated invoice.
 *
 * Idempotency:
 *   * Each `MeteredUsageReport` row has a unique `(tenantId, meter, periodStart)`
 *     triple, so re-running the cron for the same period is a no-op.
 *   * Stripe itself dedupes usage records by `(subscription_item, timestamp, action)`,
 *     so retry-after-network-error doesn't double-bill.
 *   * Each `OverageInvoiceItem` row has the same unique triple, so
 *     re-running the cron for the same period produces at most one
 *     invoice item per meter per tenant.
 *
 * Test mode:
 *   When `STRIPE_SECRET_KEY` is empty or `STRIPE_TEST_MODE=true`, the
 *   underlying `StripeService` synthesises deterministic fake ids and
 *   skips the network. This module is therefore testable without
 *   network access — see `stripe-metering.service.spec.ts`.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { UsageMeter } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import {
  MAX_REPORT_ATTEMPTS,
  STRIPE_PRICE_API_CALLS_METERED_ENV,
  STRIPE_PRICE_ACTIVE_USERS_METERED_ENV,
  STRIPE_PRICE_STORAGE_METERED_ENV,
} from './metering.constants';
import { formatQuantity, toNumber } from './decimal-math';
import type {
  MonthlyReportResult,
  OverageRow,
  UsageReportRow,
} from './metering.types';

export interface BuildReportInput {
  tenantId: string;
  meter: UsageMeter;
  periodStart: string; // ISO date (YYYY-MM-DD)
  periodEnd: string;   // ISO date (YYYY-MM-DD)
  quantity: string;
}

export interface BuildReportResult {
  report: UsageReportRow;
  /** True when the underlying Stripe call succeeded. */
  pushed: boolean;
}

@Injectable()
export class StripeMeteringService {
  private readonly logger = new Logger(StripeMeteringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  // ---------------------------------------------------------------------
  // Usage record reporting
  // ---------------------------------------------------------------------

  /**
   * Push a single usage record to Stripe for `(tenantId, meter, period)`.
   *
   * Resolution order for the Stripe subscription item:
   *   1. Look up `MeteredSubscriptionItem` for the tenant's current
   *      `StripeSubscriptionItem` (filtered by `meter`).
   *   2. If none, fall back to a per-tenant `StripeCustomer`-less env
   *      price id (test mode / pre-catalog dev).
   *
   * Returns the report row + a `pushed` flag. When `pushed = false` the
   * caller should treat the report as failed and retry on the next cron
   * tick.
   */
  async pushUsageRecord(input: BuildReportInput): Promise<BuildReportResult> {
    const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${input.periodEnd}T00:00:00.000Z`);

    // Find the subscription item to bill against. We do this BEFORE
    // touching the DB so we can short-circuit when the tenant has no
    // Stripe customer yet (e.g. legacy migration in flight).
    const resolution = await this.resolveSubscriptionItemForMeter(
      input.tenantId,
      input.meter,
    );

    if (!resolution) {
      // No subscription item means we cannot push usage. Mark as FAILED
      // so the admin can see it; the next cron tick will retry.
      const updated = await this.upsertReport({
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart,
        periodEnd,
        quantity: input.quantity,
        status: 'FAILED',
        errorMessage: 'no metered subscription item for tenant',
        stripeSubscriptionItemId: null,
        stripeUsageRecordId: null,
        attemptsIncrement: 1,
      });
      return { report: updated, pushed: false };
    }

    try {
      const result = await this.stripe.createUsageRecord({
        tenantId: input.tenantId,
        stripeSubscriptionItemId: resolution.stripeSubscriptionItemId,
        quantity: toNumber(input.quantity),
        timestamp: this.lastSecondOfDay(periodEnd),
        action: 'increment',
      });

      const updated = await this.upsertReport({
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart,
        periodEnd,
        quantity: input.quantity,
        status: 'SYNCED',
        errorMessage: null,
        stripeSubscriptionItemId: resolution.stripeSubscriptionItemId,
        stripeUsageRecordId: result.stripeUsageRecordId,
        attemptsIncrement: 1,
      });

      this.logger.log(
        `pushUsageRecord: tenant=${input.tenantId} meter=${input.meter} ` +
          `qty=${input.quantity} stripeUsageRecordId=${result.stripeUsageRecordId}`,
      );

      return { report: updated, pushed: true };
    } catch (err) {
      const message = this.truncateError(err);
      const updated = await this.upsertReport({
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart,
        periodEnd,
        quantity: input.quantity,
        status: 'FAILED',
        errorMessage: message,
        stripeSubscriptionItemId: resolution.stripeSubscriptionItemId,
        stripeUsageRecordId: null,
        attemptsIncrement: 1,
      });
      this.logger.error(
        `pushUsageRecord: tenant=${input.tenantId} meter=${input.meter} ` +
          `qty=${input.quantity} error=${message}`,
      );
      return { report: updated, pushed: false };
    }
  }

  /**
   * Mark a report as PENDING without touching Stripe. Used when the
   * cron pre-creates rows so the admin endpoint can show progress
   * even before Stripe is contacted.
   */
  async prepareReport(input: BuildReportInput): Promise<UsageReportRow> {
    const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${input.periodEnd}T00:00:00.000Z`);
    return this.upsertReport({
      tenantId: input.tenantId,
      meter: input.meter,
      periodStart,
      periodEnd,
      quantity: input.quantity,
      status: 'PENDING',
      errorMessage: null,
      stripeSubscriptionItemId: null,
      stripeUsageRecordId: null,
      attemptsIncrement: 0,
    });
  }

  /**
   * Read the persisted reports for a tenant + period.
   */
  async listReportsForPeriod(input: {
    tenantId: string;
    periodStart: string;
  }): Promise<UsageReportRow[]> {
    const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`);
    const rows = await this.prisma.meteredUsageReport.findMany({
      where: { tenantId: input.tenantId, periodStart },
      orderBy: { meter: 'asc' },
    });
    return rows.map((r) => this.toReportRow(r));
  }

  /**
   * List FAILED reports that are still eligible for retry. The
   * monthly cron uses this to find what to retry on the next run.
   */
  async listRetryableReports(limit = 200): Promise<UsageReportRow[]> {
    const rows = await this.prisma.meteredUsageReport.findMany({
      where: {
        status: 'FAILED',
        attempts: { lt: MAX_REPORT_ATTEMPTS },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toReportRow(r));
  }

  /**
   * Resolve the Stripe subscription item id for a `(tenant, meter)`.
   * Returns `null` when the tenant has no subscription yet.
   */
  async resolveSubscriptionItemForMeter(
    tenantId: string,
    meter: UsageMeter,
  ): Promise<{ stripeSubscriptionItemId: string; priceId: string } | null> {
    // Pull the current StripeSubscription for the tenant, then join to
    // its items + the metered mapping. We do the join in app code (not
    // a single Prisma `include`) because MeteredSubscriptionItem has a
    // nullable `stripeSubscriptionItemId` and we want to fall back to
    // the local id when the Stripe-side id is not yet populated.
    const subscription = await this.prisma.stripeSubscription.findUnique({
      where: { tenantId },
      include: {
        items: {
          where: { isActive: true },
          include: { metered: true },
        },
      },
    });

    if (!subscription) return null;

    for (const item of subscription.items) {
      if (item.metered?.meter === meter) {
        const stripeId = item.metered.stripeSubscriptionItemId ?? item.stripeSubscriptionItemId;
        return {
          stripeSubscriptionItemId: stripeId,
          priceId: item.metered.stripeMeteredPriceId,
        };
      }
    }

    // Fallback: dev/CI mode — no MeteredSubscriptionItem row, but we
    // can still use a price id from env. We require a Stripe item id
    // either way, so without one we can't push.
    const envPrice = this.envPriceForMeter(meter);
    if (envPrice) {
      const firstActive = subscription.items.find((i) => i.isActive);
      if (firstActive) {
        return {
          stripeSubscriptionItemId: firstActive.stripeSubscriptionItemId,
          priceId: envPrice,
        };
      }
    }

    return null;
  }

  private envPriceForMeter(meter: UsageMeter): string | null {
    const v = (name: string) => process.env[name]?.trim();
    switch (meter) {
      case 'STORAGE_GB_HOURS':
        return v(STRIPE_PRICE_STORAGE_METERED_ENV) ?? null;
      case 'API_CALL_COUNT':
        return v(STRIPE_PRICE_API_CALLS_METERED_ENV) ?? null;
      case 'ACTIVE_USERS':
        return v(STRIPE_PRICE_ACTIVE_USERS_METERED_ENV) ?? null;
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------
  // Overage invoice items
  // ---------------------------------------------------------------------

  /**
   * Append a single overage charge to the tenant's next Stripe invoice.
   *
   * Pre-conditions:
   *   * `tenantId` must have a StripeCustomer row (we look up the id).
   *   * The caller is expected to compute `amount` already (this
   *     method does not know the plan's overage price — that's the
   *     `OverageInvoiceService`'s job).
   *
   * Returns the persisted overage row.
   */
  async pushOverageInvoiceItem(input: {
    tenantId: string;
    meter: UsageMeter;
    periodStart: string;
    periodEnd: string;
    includedQuantity: string;
    actualQuantity: string;
    overageQuantity: string;
    unitPrice: string;
    amount: string;
    currency: string;
    description: string;
  }): Promise<OverageRow> {
    const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${input.periodEnd}T00:00:00.000Z`);
    const stripeCustomerId = await this.stripe.getStripeCustomerIdForTenant(input.tenantId);

    if (!stripeCustomerId) {
      return this.upsertOverage({
        ...input,
        periodStart,
        periodEnd,
        status: 'FAILED',
        errorMessage: 'no Stripe customer for tenant',
        stripeInvoiceItemId: null,
        stripeInvoiceId: null,
        attemptsIncrement: 1,
      });
    }

    try {
      const result = await this.stripe.createInvoiceItem({
        tenantId: input.tenantId,
        stripeCustomerId,
        amount: toNumber(input.amount),
        currency: input.currency,
        description: input.description,
        metadata: {
          tenantId: input.tenantId,
          meter: input.meter,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      });

      return this.upsertOverage({
        ...input,
        periodStart,
        periodEnd,
        status: 'INVOICED',
        errorMessage: null,
        stripeInvoiceItemId: result.stripeInvoiceItemId,
        stripeInvoiceId: null,
        attemptsIncrement: 1,
      });
    } catch (err) {
      const message = this.truncateError(err);
      this.logger.error(
        `pushOverageInvoiceItem: tenant=${input.tenantId} meter=${input.meter} ` +
          `amount=${input.amount} error=${message}`,
      );
      return this.upsertOverage({
        ...input,
        periodStart,
        periodEnd,
        status: 'FAILED',
        errorMessage: message,
        stripeInvoiceItemId: null,
        stripeInvoiceId: null,
        attemptsIncrement: 1,
      });
    }
  }

  /**
   * Build a human-readable invoice line description. Used by
   * `OverageInvoiceService` so the format is consistent.
   */
  static formatOverageDescription(input: {
    meter: UsageMeter;
    periodStart: string;
    periodEnd: string;
    overageQuantity: string;
    unit: string;
  }): string {
    const period = `${input.periodStart} → ${input.periodEnd}`;
    return `Overage: ${input.meter.toLowerCase().replace(/_/g, ' ')} ` +
      `(${input.overageQuantity} ${input.unit}) for ${period}`;
  }

  // ---------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------

  private async upsertReport(input: {
    tenantId: string;
    meter: UsageMeter;
    periodStart: Date;
    periodEnd: Date;
    quantity: string;
    status: 'PENDING' | 'SENT_TO_STRIPE' | 'SYNCED' | 'FAILED';
    errorMessage: string | null;
    stripeSubscriptionItemId: string | null;
    stripeUsageRecordId: string | null;
    attemptsIncrement: number;
  }): Promise<UsageReportRow> {
    const row = await this.prisma.meteredUsageReport.upsert({
      where: {
        tenantId_meter_periodStart: {
          tenantId: input.tenantId,
          meter: input.meter,
          periodStart: input.periodStart,
        },
      },
      create: {
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        quantity: formatQuantity(input.quantity),
        status: input.status,
        errorMessage: input.errorMessage,
        stripeSubscriptionItemId: input.stripeSubscriptionItemId,
        stripeUsageRecordId: input.stripeUsageRecordId,
        attempts: input.attemptsIncrement,
        reportedAt: input.status === 'SYNCED' ? new Date() : null,
      },
      update: {
        periodEnd: input.periodEnd,
        quantity: formatQuantity(input.quantity),
        status: input.status,
        errorMessage: input.errorMessage,
        stripeSubscriptionItemId: input.stripeSubscriptionItemId,
        stripeUsageRecordId: input.stripeUsageRecordId ?? undefined,
        attempts: { increment: input.attemptsIncrement },
        reportedAt: input.status === 'SYNCED' ? new Date() : undefined,
      },
    });
    return this.toReportRow(row);
  }

  private async upsertOverage(input: {
    tenantId: string;
    meter: UsageMeter;
    periodStart: Date;
    periodEnd: Date;
    includedQuantity: string;
    actualQuantity: string;
    overageQuantity: string;
    unitPrice: string;
    amount: string;
    currency: string;
    status: 'PENDING' | 'INVOICED' | 'REFUNDED' | 'FAILED';
    errorMessage: string | null;
    stripeInvoiceItemId: string | null;
    stripeInvoiceId: string | null;
    attemptsIncrement: number;
  }): Promise<OverageRow> {
    const row = await this.prisma.overageInvoiceItem.upsert({
      where: {
        tenantId_meter_periodStart: {
          tenantId: input.tenantId,
          meter: input.meter,
          periodStart: input.periodStart,
        },
      },
      create: {
        tenantId: input.tenantId,
        meter: input.meter,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        includedQuantity: formatQuantity(input.includedQuantity),
        actualQuantity: formatQuantity(input.actualQuantity),
        overageQuantity: formatQuantity(input.overageQuantity),
        unitPrice: formatQuantity(input.unitPrice),
        amount: formatQuantity(input.amount),
        currency: input.currency,
        status: input.status,
        errorMessage: input.errorMessage,
        stripeInvoiceItemId: input.stripeInvoiceItemId,
        stripeInvoiceId: input.stripeInvoiceId,
        attempts: input.attemptsIncrement,
        invoicedAt: input.status === 'INVOICED' ? new Date() : null,
      },
      update: {
        periodEnd: input.periodEnd,
        includedQuantity: formatQuantity(input.includedQuantity),
        actualQuantity: formatQuantity(input.actualQuantity),
        overageQuantity: formatQuantity(input.overageQuantity),
        unitPrice: formatQuantity(input.unitPrice),
        amount: formatQuantity(input.amount),
        currency: input.currency,
        status: input.status,
        errorMessage: input.errorMessage,
        stripeInvoiceItemId: input.stripeInvoiceItemId ?? undefined,
        stripeInvoiceId: input.stripeInvoiceId ?? undefined,
        attempts: { increment: input.attemptsIncrement },
        invoicedAt: input.status === 'INVOICED' ? new Date() : undefined,
      },
    });
    return this.toOverageRow(row);
  }

  private toReportRow(row: {
    id: string;
    tenantId: string;
    meter: UsageMeter;
    periodStart: Date;
    periodEnd: Date;
    quantity: DecimalLike;
    stripeUsageRecordId: string | null;
    stripeSubscriptionItemId: string | null;
    status: UsageReportRow['status'];
    errorMessage: string | null;
    attempts: number;
    reportedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): UsageReportRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      meter: row.meter,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      quantity: formatQuantity(String(row.quantity)),
      status: row.status,
      stripeUsageRecordId: row.stripeUsageRecordId,
      stripeSubscriptionItemId: row.stripeSubscriptionItemId,
      errorMessage: row.errorMessage,
      attempts: row.attempts,
      reportedAt: row.reportedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toOverageRow(row: {
    id: string;
    tenantId: string;
    meter: UsageMeter;
    periodStart: Date;
    periodEnd: Date;
    includedQuantity: DecimalLike;
    actualQuantity: DecimalLike;
    overageQuantity: DecimalLike;
    unitPrice: DecimalLike;
    amount: DecimalLike;
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
      includedQuantity: formatQuantity(String(row.includedQuantity)),
      actualQuantity: formatQuantity(String(row.actualQuantity)),
      overageQuantity: formatQuantity(String(row.overageQuantity)),
      unitPrice: formatQuantity(String(row.unitPrice)),
      amount: formatQuantity(String(row.amount)),
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

  private truncateError(err: unknown): string {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
    return message.length > 1000 ? `${message.slice(0, 997)}...` : message;
  }

  /**
   * Last second of a UTC day (23:59:59.999). Stripe uses Unix seconds
   * so we round down to the nearest second.
   */
  private lastSecondOfDay(dayEnd: Date): Date {
    const endOfDay = new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000 - 1);
    return new Date(Math.floor(endOfDay.getTime() / 1000) * 1000);
  }
}

/**
 * Prisma returns `Decimal` for `Decimal`-typed columns. We type-erase it
 * here so the persistence helpers don't have to import the runtime
 * class.
 */
type DecimalLike = import('./decimal-math').DecimalLike;