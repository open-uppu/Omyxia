/**
 * omyxia v2.0.0 P4.2 — UsageAdminController (super-admin endpoints).
 *
 * Five endpoints, all behind the existing `RolesGuard` + `@Roles('SUPER_ADMIN')`:
 *
 *   * `GET  /api/admin/usage/tenants/:id`
 *     → `TenantUsageSummary` for the period (default: last 30 days).
 *   * `POST /api/admin/usage/record`
 *     → Record a usage event on behalf of a tenant (e.g. backfill).
 *   * `POST /api/admin/usage/sync-now`
 *     → Trigger the monthly reporting + overage invoicing jobs on demand.
 *   * `POST /api/admin/usage/recompute`
 *     → Recompute daily rollups from raw events for a day.
 *   * `GET  /api/admin/usage/quota/:planId`
 *     → Read the `PlanUsageQuota` for a plan (admin UI surface).
 *
 * The controller is intentionally read-mostly; super-admins can record
 * events for backfill but cannot mutate plan quotas here (that's a
 * catalog-level operation owned by P1.2 / P2.5).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import type { UsageMeter } from '@prisma/client';
import { RolesGuard } from '../../auth/rbac/roles.guard';
import { Roles } from '../../auth/rbac/roles.decorator';
import { UsageCollectorService } from './usage-collector.service';
import { MeteringAggregationService } from './metering-aggregation.service';
import { StripeMeteringService } from './stripe-metering.service';
import { OverageInvoiceService } from './overage-invoice.service';
import { MeteringCronService } from './metering-cron.service';
import type {
  DailyUsageRow,
  OverageRow,
  RecordUsageEventInput,
  SyncNowResult,
  TenantUsageSummary,
  UsageReportRow,
} from './metering.types';
import { ALL_USAGE_METERS } from './metering.constants';
import { PrismaService } from '../../../common/prisma/prisma.service';

const recordEventBodySchema = z.object({
  tenantId: z.string().min(1),
  meter: z.enum(['STORAGE_GB_HOURS', 'API_CALL_COUNT', 'ACTIVE_USERS']),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, 'quantity must be a non-negative decimal string'),
  source: z.enum(['api_request', 'storage_sample', 'login', 'admin_record', 'test_seed']),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

const syncNowBodySchema = z.object({
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be YYYY-MM-DD')
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'periodEnd must be YYYY-MM-DD')
    .optional(),
  includeOverage: z.boolean().optional().default(true),
  tenantLimit: z.number().int().min(1).max(10000).optional(),
});

const recomputeBodySchema = z.object({
  usageDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'usageDate must be YYYY-MM-DD'),
  tenantId: z.string().optional(),
});

interface AdminRequest {
  user: { id: string; role: string };
}

@Controller('api/admin/usage')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class UsageAdminController {
  constructor(
    private readonly collector: UsageCollectorService,
    private readonly aggregation: MeteringAggregationService,
    private readonly stripe: StripeMeteringService,
    private readonly overage: OverageInvoiceService,
    private readonly cron: MeteringCronService,
    private readonly prisma: PrismaService,
  ) {}

  /** `GET /api/admin/usage/tenants/:id?from=&to=&meter=` */
  @Get('tenants/:id')
  async tenantSummary(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('meter') meter?: string,
  ): Promise<TenantUsageSummary> {
    this.assertDate('from', from);
    this.assertDate('to', to);

    const periodStart = from ?? this.daysAgo(30);
    const periodEnd = to ?? this.toIsoDate(new Date());

    const meters: UsageMeter[] = meter
      ? this.assertMeter(meter)
      : ([...ALL_USAGE_METERS] as UsageMeter[]);

    const dailyByMeter = new Map<UsageMeter, DailyUsageRow[]>();
    for (const m of meters) {
      const rows = await this.collector.listDaily({
        tenantId: id,
        meter: m,
        from: periodStart,
        to: periodEnd,
      });
      dailyByMeter.set(m, rows);
    }

    const summary: TenantUsageSummary = {
      tenantId: id,
      periodStart,
      periodEnd,
      meters: meters.map((m) => ({
        meter: m,
        daily: dailyByMeter.get(m) ?? [],
        monthly: null,
        overage: null,
      })),
    };

    // Best-effort hydrate of the monthly report + overage rows. We do
    // NOT 404 if either is missing — the daily rollup is the source of
    // truth for the admin UI; reports/overage are auxiliary.
    for (const entry of summary.meters) {
      const report = await this.stripe
        .listReportsForPeriod({ tenantId: id, periodStart: periodEnd })
        .then((rows) => rows.find((r) => r.meter === entry.meter) ?? null)
        .catch(() => null);
      const overageRow = await this.overage
        .listOverageForTenant({ tenantId: id, periodStart: periodEnd })
        .then((rows) => rows.find((r) => r.meter === entry.meter) ?? null)
        .catch(() => null);
      entry.monthly = report;
      entry.overage = overageRow;
    }

    return summary;
  }

  /** `POST /api/admin/usage/record` — super-admin backfill. */
  @Post('record')
  @HttpCode(HttpStatus.CREATED)
  async record(
    @Body() body: unknown,
  ): Promise<{ ok: true; recorded: number }> {
    const parsed = recordEventBodySchema.parse(body);
    const input: RecordUsageEventInput = {
      tenantId: parsed.tenantId,
      meter: parsed.meter,
      quantity: parsed.quantity,
      source: parsed.source,
      userId: parsed.userId ?? null,
      metadata: parsed.metadata ?? null,
      occurredAt: parsed.occurredAt ?? undefined,
    };
    await this.collector.recordEvent(input);
    return { ok: true, recorded: 1 };
  }

  /** `POST /api/admin/usage/sync-now` — manually trigger monthly sync. */
  @Post('sync-now')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncNow(
    @Body() body: unknown,
  ): Promise<
    SyncNowResult & {
      overage?: {
        period: { periodStart: string; periodEnd: string };
        totalSucceeded: number;
        totalFailed: number;
        totalSkipped: number;
        totalAmount: string;
      };
    }
  > {
    const parsed = syncNowBodySchema.parse(body);
    const options: {
      period?: { periodStart: string; periodEnd: string };
      tenantLimit?: number;
      skipLock?: boolean;
    } = { skipLock: true };

    if (parsed.periodStart && parsed.periodEnd) {
      options.period = { periodStart: parsed.periodStart, periodEnd: parsed.periodEnd };
    }
    if (parsed.tenantLimit) options.tenantLimit = parsed.tenantLimit;

    const report = await this.cron.runMonthlyReportWithOptions(options);
    if (!parsed.includeOverage) return report;

    const overageResult = await this.cron.runOverageInvoicingWithOptions(options);
    return {
      ...report,
      overage: {
        period: overageResult.period,
        totalSucceeded: overageResult.totalSucceeded,
        totalFailed: overageResult.totalFailed,
        totalSkipped: overageResult.totalSkipped,
        totalAmount: overageResult.totalAmount,
      },
    };
  }

  /** `POST /api/admin/usage/recompute` — recompute daily rollups. */
  @Post('recompute')
  @HttpCode(HttpStatus.OK)
  async recompute(
    @Body() body: unknown,
  ): Promise<{ ok: true; written: number }> {
    const parsed = recomputeBodySchema.parse(body);
    const usageDate = new Date(`${parsed.usageDate}T00:00:00.000Z`);
    if (Number.isNaN(usageDate.getTime())) {
      throw new BadRequestException(`Invalid usageDate: ${parsed.usageDate}`);
    }
    if (parsed.tenantId) {
      // Recompute one tenant across all meters.
      const meters: UsageMeter[] = [...ALL_USAGE_METERS];
      let written = 0;
      for (const m of meters) {
        await this.aggregation.recomputeTenantDay({
          tenantId: parsed.tenantId,
          meter: m,
          usageDate,
        });
        written += 1;
      }
      return { ok: true, written };
    }
    const written = await this.aggregation.recomputeAllForDay(usageDate);
    return { ok: true, written };
  }

  /** `GET /api/admin/usage/quota/:planId` — read a plan's quota. */
  @Get('quota/:planId')
  async quota(@Param('planId') planId: string): Promise<{
    planId: string;
    storageGb: string | null;
    apiCalls: number | null;
    activeUsers: number | null;
    storageOveragePrice: string | null;
    apiCallOveragePrice: string | null;
    activeUserOveragePrice: string | null;
    apiCallsHardCap: number | null;
  }> {
    const quota = await this.prisma.planUsageQuota.findUnique({
      where: { planId },
    });
    if (!quota) throw new NotFoundException(`No quota configured for plan ${planId}`);
    return {
      planId: quota.planId,
      storageGb: quota.storageGb?.toString() ?? null,
      apiCalls: quota.apiCalls,
      activeUsers: quota.activeUsers,
      storageOveragePrice: quota.storageOveragePrice?.toString() ?? null,
      apiCallOveragePrice: quota.apiCallOveragePrice?.toString() ?? null,
      activeUserOveragePrice: quota.activeUserOveragePrice?.toString() ?? null,
      apiCallsHardCap: quota.apiCallsHardCap,
    };
  }

  /** `GET /api/admin/usage/health` — quick health probe for the cron. */
  @Get('health')
  async health(): Promise<{
    ok: boolean;
    now: string;
    cronSchedules: Record<string, string>;
    retentionDays: number;
  }> {
    // We import lazily so the controller file stays slim; the cron
    // service holds the schedule constants.
    const { DAILY_AGGREGATION_CRON, MONTHLY_REPORTING_CRON, OVERAGE_INVOICING_CRON, EVENT_RETENTION_CRON, USAGE_EVENT_RETENTION_DAYS } = await import('./metering.constants');
    return {
      ok: true,
      now: new Date().toISOString(),
      cronSchedules: {
        dailyAggregation: DAILY_AGGREGATION_CRON,
        monthlyReporting: MONTHLY_REPORTING_CRON,
        overageInvoicing: OVERAGE_INVOICING_CRON,
        eventRetention: EVENT_RETENTION_CRON,
      },
      retentionDays: USAGE_EVENT_RETENTION_DAYS,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private assertDate(name: string, value: string | undefined): void {
    if (value === undefined) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${name} must be YYYY-MM-DD, got ${value}`);
    }
  }

  private assertMeter(value: string): UsageMeter[] {
    if (!ALL_USAGE_METERS.includes(value as UsageMeter)) {
      throw new BadRequestException(
        `meter must be one of ${ALL_USAGE_METERS.join(', ')}, got ${value}`,
      );
    }
    return [value as UsageMeter];
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private daysAgo(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return this.toIsoDate(d);
  }
}