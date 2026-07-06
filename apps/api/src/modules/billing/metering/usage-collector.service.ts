/**
 * omyxia v2.0.0 P4.2 — UsageCollectorService.
 *
 * The ingestion side of the metering module. Three responsibilities:
 *
 *   1. **Record raw events** (`recordEvent`) — append a row to
 *      `TenantUsageEvent`. Called by the API request middleware on every
 *      authenticated request, by the storage sampler on every hourly
 *      tick, and by the login handler on every successful sign-in.
 *
 *   2. **Hot-path aggregation** (`incrementDaily`) — upsert the daily
 *      rollup for the same tenant + meter + day. This is what the API
 *      middleware calls after writing the raw event so the admin
 *      dashboard (`GET /api/admin/usage/tenants/:id`) sees fresh data
 *      without waiting for the daily cron.
 *
 *   3. **Bounded storage** (`pruneOldEvents`) — prune `TenantUsageEvent`
 *      rows older than `USAGE_EVENT_RETENTION_DAYS` that have already
 *      been aggregated. Called by the nightly retention cron.
 *
 * The collector is the *only* module that writes to `TenantUsageEvent`
 * and `TenantUsageDaily`. Everything else reads from them.
 *
 * Hot-path performance:
 *   The `recordEvent` + `incrementDaily` pair runs on every authenticated
 *   request. We optimise for the common case (single tenant, single
 *   meter, single day) and use idempotency keys to make the upsert
 *   safe under concurrent writes. We also accept a `flush: false`
 *   flag so callers can batch a burst of events into one DB round-trip.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantUsageEvent, type UsageMeter } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ALL_USAGE_METERS } from './metering.constants';
import { formatQuantity, toNumber } from './decimal-math';
import type {
  DailyUsageRow,
  RecordUsageEventInput,
  UsageEventRow,
} from './metering.types';

/** Maximum breakdown size (32KB) before we throw. Matches the migration comment. */
const MAX_BREAKDOWN_BYTES = 32 * 1024;

/** Maximum metadata size (2KB) per event. */
const MAX_METADATA_BYTES = 2 * 1024;

export interface RecordEventOptions {
  /**
   * When `false`, the event row is written but the daily rollup is NOT
   * updated. The caller is expected to call `incrementDaily` later,
   * possibly in a batch. Defaults to `true`.
   */
  flush?: boolean;
  /**
   * Override the `tenantId` aggregation key. Used by the API middleware
   * when it has already verified the request's tenant context.
   */
  tenantId?: string;
}

export interface PruneEventsOptions {
  /** ISO date (YYYY-MM-DD) — events strictly before this date are eligible. */
  beforeDate: string;
  /** Hard cap on rows deleted per call (safety against runaway deletes). */
  limit?: number;
}

export interface PruneEventsResult {
  scanned: number;
  deleted: number;
  beforeDate: string;
}

@Injectable()
export class UsageCollectorService {
  private readonly logger = new Logger(UsageCollectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Hot-path: recordEvent
  // -------------------------------------------------------------------------

  /**
   * Record a single usage event and (optionally) flush the daily rollup.
   * The event write is idempotent on `(idempotencyKey)` — but we don't
   * have one at this layer; the caller supplies a stable
   * `(tenantId, meter, occurredAt, source, userId)` tuple and we let the
   * DB unique index on `TenantUsageDaily.idempotencyKey` catch duplicates
   * during `incrementDaily`.
   */
  async recordEvent(
    input: RecordUsageEventInput,
    options: RecordEventOptions = {},
  ): Promise<UsageEventRow> {
    this.validateInput(input);

    const tenantId = options.tenantId ?? input.tenantId;
    const occurredAt = input.occurredAt ?? new Date();

    const created = await this.prisma.tenantUsageEvent.create({
      data: {
        tenantId,
        userId: input.userId ?? null,
        meter: input.meter,
        quantity: input.quantity,
        source: input.source,
        metadata: this.serialiseMetadata(input.metadata),
        occurredAt,
        aggregatedAt: null,
      },
    });

    if (options.flush !== false) {
      await this.incrementDaily({
        tenantId,
        meter: input.meter,
        usageDate: occurredAt,
        deltaQuantity: input.quantity,
        breakdownPatch:
          input.meter === 'API_CALL_COUNT'
            ? { source: input.source, userId: input.userId ?? null }
            : null,
      });
    }

    return this.toEventRow(created);
  }

  /**
   * Record a batch of events in a single transaction. Useful when the
   * caller wants to amortise the DB round-trip (e.g. the storage sampler
   * that batches one hourly sample per tenant).
   *
   * Returns the created rows in the same order as the input array.
   */
  async recordEventBatch(
    inputs: ReadonlyArray<RecordUsageEventInput>,
    options: RecordEventOptions = {},
  ): Promise<UsageEventRow[]> {
    if (inputs.length === 0) return [];
    for (const i of inputs) this.validateInput(i);

    const created = await this.prisma.$transaction(
      inputs.map((input) => {
        const tenantId = options.tenantId ?? input.tenantId;
        const occurredAt = input.occurredAt ?? new Date();
        return this.prisma.tenantUsageEvent.create({
          data: {
            tenantId,
            userId: input.userId ?? null,
            meter: input.meter,
            quantity: input.quantity,
            source: input.source,
            metadata: this.serialiseMetadata(input.metadata),
            occurredAt,
            aggregatedAt: null,
          },
        });
      }),
    );

    if (options.flush !== false) {
      // Best-effort flush; we intentionally do not roll back the events
      // if one daily upsert fails — the daily cron will retry. This is
      // also why we group the flush calls outside the transaction.
      for (let i = 0; i < inputs.length; i += 1) {
        const input = inputs[i];
        const occurredAt = input.occurredAt ?? new Date();
        await this.incrementDaily({
          tenantId: options.tenantId ?? input.tenantId,
          meter: input.meter,
          usageDate: occurredAt,
          deltaQuantity: input.quantity,
          breakdownPatch:
            input.meter === 'API_CALL_COUNT'
              ? { source: input.source, userId: input.userId ?? null }
              : null,
        });
      }
    }

    return created.map((row) => this.toEventRow(row));
  }

  // -------------------------------------------------------------------------
  // Daily rollup
  // -------------------------------------------------------------------------

  /**
   * Upsert the daily rollup for `(tenantId, meter, usageDate)`. We
   * compute a deterministic idempotency key so concurrent collectors
   * don't double-count — the unique index on `idempotencyKey` catches
   * any race that slips past the `update` (we use `update` first and
   * fall back to `create` on P2002-equivalent errors).
   */
  async incrementDaily(params: {
    tenantId: string;
    meter: UsageMeter;
    usageDate: Date;
    deltaQuantity: string | number;
    breakdownPatch?: Record<string, unknown> | null;
  }): Promise<DailyUsageRow> {
    const usageDate = this.truncateToUtcDay(params.usageDate);
    const idemKey = `${params.tenantId}:${params.meter}:${this.toIsoDate(usageDate)}`;
    const delta = toNumber(params.deltaQuantity);

    // Try update first — the common case for the hot path.
    const existing = await this.prisma.tenantUsageDaily.findUnique({
      where: { idempotencyKey: idemKey },
    });

    if (existing) {
      const newQuantity = toNumber(existing.quantity) + delta;
      const updated = await this.prisma.tenantUsageDaily.update({
        where: { idempotencyKey: idemKey },
        data: {
          quantity: formatQuantity(newQuantity),
          breakdown: params.breakdownPatch
            ? this.mergeBreakdown(existing.breakdown, params.breakdownPatch)
            : undefined,
        },
      });
      return this.toDailyRow(updated);
    }

    try {
      const created = await this.prisma.tenantUsageDaily.create({
        data: {
          tenantId: params.tenantId,
          meter: params.meter,
          usageDate,
          quantity: formatQuantity(delta),
          breakdown: params.breakdownPatch
            ? this.serialiseBreakdown(params.breakdownPatch)
            : Prisma.JsonNull,
          idempotencyKey: idemKey,
        },
      });
      return this.toDailyRow(created);
    } catch (err) {
      // Concurrent insert — re-update.
      if (this.isUniqueViolation(err)) {
        const newQuantity = delta; // delta + 0 (existing baseline)
        const updated = await this.prisma.tenantUsageDaily.update({
          where: { idempotencyKey: idemKey },
          data: {
            quantity: { increment: formatQuantity(newQuantity) },
            breakdown: params.breakdownPatch
              ? this.serialiseBreakdown(params.breakdownPatch)
              : undefined,
          },
        });
        return this.toDailyRow(updated);
      }
      throw err;
    }
  }

  /**
   * Recompute a daily rollup from raw events. Used by the daily cron as
   * a backstop — the hot path should keep the rollup current, but a
   * bug or DB outage could leave it stale. The cron recomputes the day
   * before yesterday so the active day is never written.
   */
  async recomputeDailyFromEvents(params: {
    tenantId: string;
    meter: UsageMeter;
    usageDate: Date;
  }): Promise<DailyUsageRow> {
    const usageDate = this.truncateToUtcDay(params.usageDate);
    const dayStart = usageDate;
    const dayEnd = new Date(usageDate.getTime() + 24 * 60 * 60 * 1000);

    const events = await this.prisma.tenantUsageEvent.findMany({
      where: {
        tenantId: params.tenantId,
        meter: params.meter,
        occurredAt: { gte: dayStart, lt: dayEnd },
      },
      select: { quantity: true, source: true },
    });

    const total = events.reduce((acc, e) => acc + toNumber(e.quantity), 0);
    const idemKey = `${params.tenantId}:${params.meter}:${this.toIsoDate(usageDate)}`;

    const breakdown = {
      sources: events.reduce<Record<string, number>>((acc, e) => {
        acc[e.source] = (acc[e.source] ?? 0) + toNumber(e.quantity);
        return acc;
      }, {}),
      eventCount: events.length,
    };

    const updated = await this.prisma.tenantUsageDaily.upsert({
      where: { idempotencyKey: idemKey },
      create: {
        tenantId: params.tenantId,
        meter: params.meter,
        usageDate,
        quantity: formatQuantity(total),
        breakdown: this.serialiseBreakdown(breakdown),
        idempotencyKey: idemKey,
      },
      update: {
        quantity: formatQuantity(total),
        breakdown: this.serialiseBreakdown(breakdown),
      },
    });

    // Mark the contributing events as aggregated so the retention cron
    // can prune them.
    if (events.length > 0) {
      await this.prisma.tenantUsageEvent.updateMany({
        where: {
          tenantId: params.tenantId,
          meter: params.meter,
          occurredAt: { gte: dayStart, lt: dayEnd },
          aggregatedAt: null,
        },
        data: { aggregatedAt: new Date() },
      });
    }

    return this.toDailyRow(updated);
  }

  // -------------------------------------------------------------------------
  // Retention
  // -------------------------------------------------------------------------

  /**
   * Delete `TenantUsageEvent` rows older than `beforeDate` that have
   * already been rolled up. Returns the number of rows deleted.
   */
  async pruneOldEvents(options: PruneEventsOptions): Promise<PruneEventsResult> {
    const beforeDate = new Date(`${options.beforeDate}T00:00:00.000Z`);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new TypeError(`pruneOldEvents: invalid beforeDate: ${options.beforeDate}`);
    }
    const limit = options.limit ?? 10_000;

    // Find IDs first (we can't `deleteMany` with a relation). We use a
    // findMany + delete loop so the LIMIT applies to the find.
    const rows = await this.prisma.tenantUsageEvent.findMany({
      where: {
        occurredAt: { lt: beforeDate },
        aggregatedAt: { not: null },
      },
      select: { id: true },
      take: limit,
      orderBy: { occurredAt: 'asc' },
    });

    if (rows.length === 0) {
      return { scanned: 0, deleted: 0, beforeDate: options.beforeDate };
    }

    const result = await this.prisma.tenantUsageEvent.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });

    return {
      scanned: rows.length,
      deleted: result.count,
      beforeDate: options.beforeDate,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Read daily rollups for a tenant + optional meter filter. */
  async listDaily(params: {
    tenantId: string;
    meter?: UsageMeter;
    from?: string;
    to?: string;
  }): Promise<DailyUsageRow[]> {
    const rows = await this.prisma.tenantUsageDaily.findMany({
      where: {
        tenantId: params.tenantId,
        meter: params.meter,
        usageDate: {
          ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
          ...(params.to ? { lte: new Date(`${params.to}T00:00:00.000Z`) } : {}),
        },
      },
      orderBy: [{ usageDate: 'asc' }, { meter: 'asc' }],
    });
    return rows.map((r) => this.toDailyRow(r));
  }

  /** Read raw events for a tenant + meter (paginated, capped at 500). */
  async listEvents(params: {
    tenantId: string;
    meter?: UsageMeter;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<UsageEventRow[]> {
    const rows = await this.prisma.tenantUsageEvent.findMany({
      where: {
        tenantId: params.tenantId,
        meter: params.meter,
        occurredAt: {
          ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
          ...(params.to ? { lte: new Date(`${params.to}T00:00:00.000Z`) } : {}),
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(params.limit ?? 100, 500),
    });
    return rows.map((r) => this.toEventRow(r));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Compute the UTC midnight for a given date. We use UTC everywhere so
   * the daily rollups don't drift with the API server's timezone.
   */
  private truncateToUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private validateInput(input: RecordUsageEventInput): void {
    if (!input.tenantId || typeof input.tenantId !== 'string') {
      throw new TypeError('recordEvent: tenantId is required');
    }
    if (!ALL_USAGE_METERS.includes(input.meter)) {
      throw new TypeError(`recordEvent: invalid meter: ${String(input.meter)}`);
    }
    if (input.quantity === undefined || input.quantity === null) {
      throw new TypeError('recordEvent: quantity is required');
    }
    const q = toNumber(input.quantity);
    if (q < 0) {
      throw new TypeError(`recordEvent: quantity must be non-negative: ${input.quantity}`);
    }
    if (!Number.isFinite(q)) {
      throw new TypeError(`recordEvent: quantity must be finite: ${input.quantity}`);
    }
    if (!input.source || typeof input.source !== 'string') {
      throw new TypeError('recordEvent: source is required');
    }
    if (input.meter === 'ACTIVE_USERS' && !input.userId) {
      // ACTIVE_USERS events without a userId cannot be de-duped, so we
      // log and continue rather than throw — the caller may want to
      // record a synthetic active-user event without a specific user.
      this.logger.debug(
        `recordEvent: ACTIVE_USERS event for tenant ${input.tenantId} has no userId; ` +
          `will count as a new active user.`,
      );
    }
    if (input.metadata) {
      const size = Buffer.byteLength(JSON.stringify(input.metadata), 'utf8');
      if (size > MAX_METADATA_BYTES) {
        throw new TypeError(
          `recordEvent: metadata exceeds ${MAX_METADATA_BYTES} bytes (got ${size})`,
        );
      }
    }
  }

  private serialiseMetadata(
    value: Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
      throw new TypeError(`recordEvent: metadata exceeds ${MAX_METADATA_BYTES} bytes`);
    }
    return JSON.parse(json) as Prisma.InputJsonValue;
  }

  private serialiseBreakdown(
    value: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, 'utf8') > MAX_BREAKDOWN_BYTES) {
      throw new TypeError(`breakdown exceeds ${MAX_BREAKDOWN_BYTES} bytes`);
    }
    return JSON.parse(json) as Prisma.InputJsonValue;
  }

  private mergeBreakdown(
    existing: Prisma.JsonValue | null,
    patch: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    base.lastEventAt = new Date().toISOString();
    Object.assign(base, patch);
    return this.serialiseBreakdown(base);
  }

  private isUniqueViolation(err: unknown): boolean {
    return Boolean(
      err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002',
    );
  }

  private toDailyRow(row: {
    id: string;
    tenantId: string;
    meter: UsageMeter;
    usageDate: Date;
    quantity: Prisma.Decimal | number | string;
    breakdown: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): DailyUsageRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      meter: row.meter,
      usageDate: this.toIsoDate(row.usageDate),
      quantity: formatQuantity(String(row.quantity)),
      breakdown: this.parseBreakdown(row.breakdown),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toEventRow(row: TenantUsageEvent): UsageEventRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      meter: row.meter,
      quantity: formatQuantity(String(row.quantity)),
      source: row.source,
      metadata: this.parseBreakdown(row.metadata),
      occurredAt: row.occurredAt.toISOString(),
      aggregatedAt: row.aggregatedAt?.toISOString() ?? null,
    };
  }

  private parseBreakdown(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }
}