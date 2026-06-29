import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';

export interface AnalyticsEventInput {
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  properties?: Record<string, any>;
  userId?: string;
  occurredAt?: Date;
}

export interface StatsOptions {
  metric: 'dau' | 'wau' | 'mau' | 'events_per_day' | 'unique_users' | 'total_events';
  from: Date;
  to: Date;
  tenantId?: string;
}

export interface TopResourceOptions {
  type: string;
  limit?: number;
  from?: Date;
  to?: Date;
  tenantId?: string;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Capture an analytics event
   */
  async track(input: AnalyticsEventInput): Promise<void> {
    const tenantId = input.tenantId || this.tenantContext.getTenantId();
    const userId = input.userId || this.tenantContext.getUserId();

    if (!tenantId) {
      throw new Error('Tenant context required for analytics tracking');
    }

    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "AnalyticsEvent" ("tenantId", "userId", "eventType", "resourceType", "resourceId", properties, "occurredAt", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      tenantId,
      userId || null,
      input.eventType,
      input.resourceType || null,
      input.resourceId || null,
      JSON.stringify(input.properties || {}),
      input.occurredAt || new Date(),
    );
  }

  /**
   * Batch capture multiple events
   */
  async trackBatch(events: AnalyticsEventInput[]): Promise<void> {
    if (events.length === 0) return;

    const tenantId = this.tenantContext.getTenantId();
    const userId = this.tenantContext.getUserId();

    if (!tenantId) {
      throw new Error('Tenant context required for analytics tracking');
    }

    // Use a single transaction for batch insert
    await this.prisma.$transaction(
      events.map((event) =>
        this.prisma.$executeRawUnsafe(
          `
          INSERT INTO "AnalyticsEvent" ("tenantId", "userId", "eventType", "resourceType", "resourceId", properties, "occurredAt", "createdAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          `,
          tenantId,
          event.userId || userId || null,
          event.eventType,
          event.resourceType || null,
          event.resourceId || null,
          JSON.stringify(event.properties || {}),
          event.occurredAt || new Date(),
        ),
      ),
    );
  }

  /**
   * Get aggregated stats for a metric over a time range
   */
  async getStats(options: StatsOptions): Promise<{
    metric: string;
    from: Date;
    to: Date;
    data: Array<{ date: string; value: number }>;
    total: number;
  }> {
    const tenantId = options.tenantId || this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new Error('Tenant context required for stats');
    }

    const { metric, from, to } = options;

    let query: string;
    let params: any[] = [tenantId, from, to];

    switch (metric) {
      case 'dau': // Daily Active Users
        query = `
          SELECT DATE("occurredAt") as date, COUNT(DISTINCT "userId") as value
          FROM "AnalyticsEvent"
          WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3 AND "userId" IS NOT NULL
          GROUP BY DATE("occurredAt")
          ORDER BY date ASC
        `;
        break;

      case 'wau': // Weekly Active Users
        query = `
          SELECT DATE_TRUNC('week', "occurredAt")::DATE as date, COUNT(DISTINCT "userId") as value
          FROM "AnalyticsEvent"
          WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3 AND "userId" IS NOT NULL
          GROUP BY DATE_TRUNC('week', "occurredAt")
          ORDER BY date ASC
        `;
        break;

      case 'mau': // Monthly Active Users
        query = `
          SELECT DATE_TRUNC('month', "occurredAt")::DATE as date, COUNT(DISTINCT "userId") as value
          FROM "AnalyticsEvent"
          WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3 AND "userId" IS NOT NULL
          GROUP BY DATE_TRUNC('month', "occurredAt")
          ORDER BY date ASC
        `;
        break;

      case 'events_per_day':
        query = `
          SELECT DATE("occurredAt") as date, COUNT(*) as value
          FROM "AnalyticsEvent"
          WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3
          GROUP BY DATE("occurredAt")
          ORDER BY date ASC
        `;
        break;

      case 'unique_users':
        query = `
          SELECT DATE("occurredAt") as date, COUNT(DISTINCT "userId") as value
          FROM "AnalyticsEvent"
          WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3 AND "userId" IS NOT NULL
          GROUP BY DATE("occurredAt")
          ORDER BY date ASC
        `;
        break;

      case 'total_events':
        query = `
          SELECT DATE("occurredAt") as date, COUNT(*) as value
          FROM "AnalyticsEvent"
          WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3
          GROUP BY DATE("occurredAt")
          ORDER BY date ASC
        `;
        break;

      default:
        throw new Error(`Unknown metric: ${metric}`);
    }

    const results = await this.prisma.$queryRawUnsafe<Array<{ date: Date; value: bigint }>>(query, ...params);

    const data = results.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      value: Number(row.value),
    }));

    const total = data.reduce((sum, d) => sum + d.value, 0);

    return {
      metric,
      from,
      to,
      data,
      total,
    };
  }

  /**
   * Get top resources by event count
   */
  async getTopResources(options: TopResourceOptions): Promise<Array<{
    resourceType: string;
    resourceId: string;
    count: number;
    lastEventAt: Date;
  }>> {
    const tenantId = options.tenantId || this.tenantContext.getTenantId();

    if (!tenantId) {
      throw new Error('Tenant context required for top resources');
    }

    const { type, limit = 10, from, to } = options;

    let dateFilter = '';
    const params: any[] = [tenantId, type];

    if (from && to) {
      dateFilter = 'AND "occurredAt" >= $3 AND "occurredAt" <= $4';
      params.push(from, to);
    } else if (from) {
      dateFilter = 'AND "occurredAt" >= $3';
      params.push(from);
    } else if (to) {
      dateFilter = 'AND "occurredAt" <= $3';
      params.push(to);
    }

    const query = `
      SELECT "resourceType", "resourceId", COUNT(*) as count, MAX("occurredAt") as "lastEventAt"
      FROM "AnalyticsEvent"
      WHERE "tenantId" = $1 AND "resourceType" = $2 ${dateFilter} AND "resourceId" IS NOT NULL
      GROUP BY "resourceType", "resourceId"
      ORDER BY count DESC
      LIMIT $${params.length + 1}
    `;

    params.push(limit);

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        resourceType: string;
        resourceId: string;
        count: bigint;
        lastEventAt: Date;
      }>
    >(query, ...params);

    return results.map((row) => ({
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      count: Number(row.count),
      lastEventAt: row.lastEventAt,
    }));
  }

  /**
   * Get event type distribution
   */
  async getEventTypeDistribution(
    tenantId?: string,
    from?: Date,
    to?: Date,
  ): Promise<Array<{ eventType: string; count: number }>> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for event distribution');
    }

    let query = `
      SELECT "eventType", COUNT(*) as count
      FROM "AnalyticsEvent"
      WHERE "tenantId" = $1
    `;
    const params: any[] = [effectiveTenantId];

    if (from) {
      query += ` AND "occurredAt" >= $2`;
      params.push(from);
    }
    if (to) {
      query += ` AND "occurredAt" <= $${params.length + 1}`;
      params.push(to);
    }

    query += ` GROUP BY "eventType" ORDER BY count DESC`;

    const results = await this.prisma.$queryRawUnsafe<
      Array<{ eventType: string; count: bigint }>
    >(query, ...params);

    return results.map((row) => ({
      eventType: row.eventType,
      count: Number(row.count),
    }));
  }

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(
    userId: string,
    tenantId?: string,
    from?: Date,
    to?: Date,
  ): Promise<{
    totalEvents: number;
    eventTypes: Record<string, number>;
    resourcesAccessed: Record<string, number>;
    firstActivity: Date | null;
    lastActivity: Date | null;
  }> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for user activity');
    }

    let query = `
      SELECT
        COUNT(*) as total,
        MIN("occurredAt") as first,
        MAX("occurredAt") as last
      FROM "AnalyticsEvent"
      WHERE "tenantId" = $1 AND "userId" = $2
    `;
    const params: any[] = [effectiveTenantId, userId];

    if (from) {
      query += ` AND "occurredAt" >= $3`;
      params.push(from);
    }
    if (to) {
      query += ` AND "occurredAt" <= $${params.length + 1}`;
      params.push(to);
    }

    const [summary, eventTypes, resources] = await Promise.all([
      this.prisma.$queryRawUnsafe<[{ total: bigint; first: Date | null; last: Date | null }]>(query, ...params),
      this.prisma.$queryRawUnsafe<Array<{ eventType: string; count: bigint }>>(
        `
        SELECT "eventType", COUNT(*) as count
        FROM "AnalyticsEvent"
        WHERE "tenantId" = $1 AND "userId" = $2 ${from ? 'AND "occurredAt" >= $3' : ''} ${to ? `AND "occurredAt" <= $${from ? 4 : 3}` : ''}
        GROUP BY "eventType"
        `,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<Array<{ resourceType: string; count: bigint }>>(
        `
        SELECT "resourceType", COUNT(*) as count
        FROM "AnalyticsEvent"
        WHERE "tenantId" = $1 AND "userId" = $2 AND "resourceType" IS NOT NULL ${from ? 'AND "occurredAt" >= $3' : ''} ${to ? `AND "occurredAt" <= $${from ? 4 : 3}` : ''}
        GROUP BY "resourceType"
        `,
        ...params,
      ),
    ]);

    return {
      totalEvents: Number(summary[0]?.total || 0),
      eventTypes: Object.fromEntries(eventTypes.map((r) => [r.eventType, Number(r.count)])),
      resourcesAccessed: Object.fromEntries(resources.map((r) => [r.resourceType, Number(r.count)])),
      firstActivity: summary[0]?.first || null,
      lastActivity: summary[0]?.last || null,
    };
  }

  /**
   * Get funnel analysis for a sequence of events
   */
  async getFunnel(
    steps: string[],
    tenantId?: string,
    from?: Date,
    to?: Date,
    windowMinutes: number = 60,
  ): Promise<Array<{
    step: string;
    eventType: string;
    count: number;
    conversionRate: number;
  }>> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for funnel');
    }

    // This is a simplified funnel - in production you'd use a more sophisticated approach
    // For each step, count unique users who performed that event after the previous step
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const eventType = steps[i];

      let query = `
        SELECT COUNT(DISTINCT "userId") as count
        FROM "AnalyticsEvent"
        WHERE "tenantId" = $1 AND "eventType" = $2
      `;
      const params: any[] = [effectiveTenantId, eventType];

      if (from) {
        query += ` AND "occurredAt" >= $3`;
        params.push(from);
      }
      if (to) {
        query += ` AND "occurredAt" <= $${params.length + 1}`;
        params.push(to);
      }

      // For steps after the first, filter to users who completed previous steps
      // (simplified - just counting unique users per step for now)
      const result = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(query, ...params);
      const count = Number(result[0]?.count || 0);

      const conversionRate = i === 0 ? 100 : (count / Number(results[0]?.count || 1)) * 100;

      results.push({
        step: `step_${i + 1}`,
        eventType,
        count,
        conversionRate: Math.round(conversionRate * 100) / 100,
      });
    }

    return results;
  }

  /**
   * Get real-time event count (last 5 minutes)
   */
  async getRealtimeCount(tenantId?: string): Promise<number> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for realtime count');
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const result = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `
      SELECT COUNT(*) as count
      FROM "AnalyticsEvent"
      WHERE "tenantId" = $1 AND "occurredAt" >= $2
      `,
      effectiveTenantId,
      fiveMinutesAgo,
    );

    return Number(result[0]?.count || 0);
  }

  /**
   * Get hourly event breakdown for a day
   */
  async getHourlyBreakdown(date: Date, tenantId?: string): Promise<Array<{ hour: number; count: number }>> {
    const effectiveTenantId = tenantId || this.tenantContext.getTenantId();

    if (!effectiveTenantId) {
      throw new Error('Tenant context required for hourly breakdown');
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const results = await this.prisma.$queryRawUnsafe<
      Array<{ hour: number; count: bigint }>
    >(
      `
      SELECT EXTRACT(HOUR FROM "occurredAt")::INT as hour, COUNT(*) as count
      FROM "AnalyticsEvent"
      WHERE "tenantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3
      GROUP BY EXTRACT(HOUR FROM "occurredAt")
      ORDER BY hour ASC
      `,
      effectiveTenantId,
      startOfDay,
      endOfDay,
    );

    // Fill in missing hours with 0
    const hourlyMap = new Map(results.map((r) => [r.hour, Number(r.count)]));
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: hourlyMap.get(i) || 0,
    }));
  }
}