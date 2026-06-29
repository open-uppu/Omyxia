import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AnalyticsService, AnalyticsEventInput } from './analytics.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/roles.guard';
import { Roles } from '../modules/auth/roles.decorator';
import { TenantRole } from '@prisma/client';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Capture analytics event from client' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        eventType: { type: 'string', description: 'Event type identifier (e.g., page_view, lead_created, email_sent)' },
        resourceType: { type: 'string', description: 'Resource type (e.g., crm_lead, email, employee)' },
        resourceId: { type: 'string', description: 'Resource ID' },
        properties: { type: 'object', description: 'Additional event properties' },
        occurredAt: { type: 'string', format: 'date-time', description: 'Event timestamp (default: now)' },
      },
      required: ['eventType'],
    },
  })
  async captureEvent(@Body() event: AnalyticsEventInput) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { success: false, message: 'No tenant context' };
    }

    await this.analyticsService.track({
      ...event,
      tenantId,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
    });

    return { success: true };
  }

  @Post('events/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Capture multiple analytics events in batch' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventType: { type: 'string' },
              resourceType: { type: 'string' },
              resourceId: { type: 'string' },
              properties: { type: 'object' },
              occurredAt: { type: 'string', format: 'date-time' },
            },
            required: ['eventType'],
          },
        },
      },
      required: ['events'],
    },
  })
  async captureEventsBatch(@Body() body: { events: AnalyticsEventInput[] }) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { success: false, message: 'No tenant context' };
    }

    await this.analyticsService.trackBatch(
      body.events.map((e) => ({
        ...e,
        tenantId,
        occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
      })),
    );

    return { success: true, count: body.events.length };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated stats for a metric' })
  @ApiQuery({ name: 'metric', required: true, enum: ['dau', 'wau', 'mau', 'events_per_day', 'unique_users', 'total_events'] })
  @ApiQuery({ name: 'from', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  async getStats(
    @Query('metric') metric: 'dau' | 'wau' | 'mau' | 'events_per_day' | 'unique_users' | 'total_events',
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { metric, from, to, data: [], total: 0 };
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return { metric, from, to, data: [], total: 0, error: 'Invalid date format' };
    }

    return this.analyticsService.getStats({ metric, from: fromDate, to: toDate, tenantId });
  }

  @Get('top-resources')
  @ApiOperation({ summary: 'Get top resources by event count' })
  @ApiQuery({ name: 'type', required: true, description: 'Resource type (e.g., crm_lead, email)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default 10)' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO 8601)' })
  async getTopResources(
    @Query('type') type: string,
    @Query('limit') limit?: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return [];
    }

    return this.analyticsService.getTopResources({
      type,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 100) : 10,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      tenantId,
    });
  }

  @Get('event-distribution')
  @ApiOperation({ summary: 'Get event type distribution' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO 8601)' })
  async getEventDistribution(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return [];
    }

    return this.analyticsService.getEventTypeDistribution(
      tenantId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('user-activity/:userId')
  @ApiOperation({ summary: 'Get user activity summary' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO 8601)' })
  async getUserActivity(
    @Query('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { totalEvents: 0, eventTypes: {}, resourcesAccessed: {}, firstActivity: null, lastActivity: null };
    }

    return this.analyticsService.getUserActivitySummary(
      userId,
      tenantId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Get funnel analysis for event sequence' })
  @ApiQuery({ name: 'steps', required: true, description: 'Comma-separated event types (e.g., page_view,lead_created,deal_won)' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'window', required: false, type: Number, description: 'Conversion window in minutes (default 60)' })
  async getFunnel(
    @Query('steps') steps: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('window') window?: number,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return [];
    }

    const stepList = steps.split(',').map((s) => s.trim()).filter(Boolean);
    if (stepList.length === 0) {
      return [];
    }

    return this. return this.analyticsService.getFunnel(
      stepList,
      tenantId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      window || 60,
    );
  }

  @Get('realtime')
  @ApiOperation({ summary: 'Get real-time event count (last 5 minutes)' })
  async getRealtime() {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { count: 0 };
    }

    const count = await this.analyticsService.getRealtimeCount(tenantId);
    return { count };
  }

  @Get('hourly')
  @ApiOperation({ summary: 'Get hourly event breakdown for a day' })
  @ApiQuery({ name: 'date', required: true, description: 'Date (ISO 8601, date only)' })
  async getHourly(@Query('date') date: string) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return [];
    }

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return [];
    }

    return this.analyticsService.getHourlyBreakdown(dateObj, tenantId);
  }

  // Internal helper endpoints for other modules to track events
  @Post('internal/track')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Internal endpoint for modules to track events (no auth required for internal use)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        eventType: { type: 'string' },
        resourceType: { type: 'string' },
        resourceId: { type: 'string' },
        properties: { type: 'object' },
        userId: { type: 'string' },
        tenantId: { type: 'string' },
      },
      required: ['eventType', 'tenantId'],
    },
  })
  async internalTrack(@Body() event: AnalyticsEventInput & { tenantId: string; userId?: string }) {
    await this.analyticsService.track({
      ...event,
      occurredAt: event.occurredAt || new Date(),
    });

    return { success: true };
  }

  @Post('internal/track-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Internal batch tracking endpoint' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventType: { type: 'string' },
              resourceType: { type: 'string' },
              resourceId: { type: 'string' },
              properties: { type: 'object' },
              userId: { type: 'string' },
              tenantId: { type: 'string' },
            },
            required: ['eventType', 'tenantId'],
          },
        },
      },
      required: ['events'],
    },
  })
  async internalTrackBatch(@Body() body: { events: (AnalyticsEventInput & { tenantId: string; userId?: string })[] }) {
    // Process each event with its own tenant context
    for (const event of body.events) {
      await this.analyticsService.track({
        ...event,
        occurredAt: event.occurredAt || new Date(),
      });
    }

    return { success: true, count: body.events.length };
  }
}