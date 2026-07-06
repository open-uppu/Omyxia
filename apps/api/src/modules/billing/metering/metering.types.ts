/**
 * omyxia v2.0.0 P4.2 — Usage-metering types.
 *
 * Domain types for the metering module. We project the Prisma rows into
 * small TypeScript interfaces so the rest of the module only ever works
 * with these shapes — never full `Prisma.X` rows. That gives us:
 *
 *   1. Stable mocking in tests (no need to reproduce the whole Prisma
 *      schema with deeply nested `Decimal`/`Date` combinations).
 *   2. A place to encode invariants (e.g. `quantity` is always a string
 *      so we never lose precision through JS's `number` type).
 *   3. Clean DTO boundaries for the HTTP layer.
 */

import type {
  OverageStatus,
  TenantUsageDaily,
  TenantUsageEvent,
  UsageMeter,
  UsageReportStatus,
} from '@prisma/client';

/** Decimal-as-string alias. Matches the wire format Prisma emits. */
export type DecimalString = string;

/** Source tag for `TenantUsageEvent.source`. Centralised for grep-ability. */
export type UsageEventSource =
  | 'api_request'
  | 'storage_sample'
  | 'login'
  | 'admin_record'
  | 'test_seed';

/** Shape we pass to `UsageCollectorService.recordEvent(...)`. */
export interface RecordUsageEventInput {
  tenantId: string;
  meter: UsageMeter;
  /** Quantity increment. For API_CALL_COUNT this is always 1. */
  quantity: DecimalString;
  source: UsageEventSource;
  /** Optional user id (required for ACTIVE_USERS de-dup). */
  userId?: string | null;
  /** Optional opaque context (endpoint, file key, etc.). */
  metadata?: Record<string, unknown> | null;
  /**
   * Override the event timestamp. Used by the test suite to seed events
   * at arbitrary points in time (otherwise defaults to `new Date()`).
   */
  occurredAt?: Date;
}

/** In-memory projection of a `TenantUsageDaily` row. */
export interface DailyUsageRow {
  id: string;
  tenantId: string;
  meter: UsageMeter;
  usageDate: string; // ISO date (YYYY-MM-DD)
  quantity: DecimalString;
  breakdown: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** In-memory projection of a `TenantUsageEvent` row. */
export interface UsageEventRow {
  id: string;
  tenantId: string;
  userId: string | null;
  meter: UsageMeter;
  quantity: DecimalString;
  source: string;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  aggregatedAt: string | null;
}

/**
 * Aggregated monthly total for a single (tenant, meter) pair. Lives in
 * `MeteringAggregationService.runMonthlyAggregation()` output. This is
 * the value we hand to `StripeMeteringService` to push to Stripe.
 */
export interface MonthlyMeterTotal {
  tenantId: string;
  meter: UsageMeter;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  quantity: DecimalString;
}

/** Snapshot of a `MeteredUsageReport` row used by the admin endpoint. */
export interface UsageReportRow {
  id: string;
  tenantId: string;
  meter: UsageMeter;
  periodStart: string;
  periodEnd: string;
  quantity: DecimalString;
  status: UsageReportStatus;
  stripeUsageRecordId: string | null;
  stripeSubscriptionItemId: string | null;
  errorMessage: string | null;
  attempts: number;
  reportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Snapshot of an `OverageInvoiceItem` row used by the admin endpoint. */
export interface OverageRow {
  id: string;
  tenantId: string;
  meter: UsageMeter;
  periodStart: string;
  periodEnd: string;
  includedQuantity: DecimalString;
  actualQuantity: DecimalString;
  overageQuantity: DecimalString;
  unitPrice: DecimalString;
  amount: DecimalString;
  currency: string;
  status: OverageStatus;
  stripeInvoiceItemId: string | null;
  stripeInvoiceId: string | null;
  errorMessage: string | null;
  attempts: number;
  invoicedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Plan-quota projection used by the overage computation. */
export interface PlanUsageQuotaRow {
  id: string;
  planId: string;
  storageGb: DecimalString | null;
  apiCalls: number | null;
  activeUsers: number | null;
  storageOveragePrice: DecimalString | null;
  apiCallOveragePrice: DecimalString | null;
  activeUserOveragePrice: DecimalString | null;
  apiCallsHardCap: number | null;
}

/**
 * Result of running the monthly report for a single tenant. Used by
 * `MeteringCronService` to aggregate per-tenant successes/failures.
 */
export interface MonthlyReportResult {
  tenantId: string;
  totalReports: number;
  succeeded: number;
  failed: number;
  /** Maps `meter → stripeUsageRecordId` for reporting observability. */
  usageRecordIds: Record<UsageMeter, string | null>;
  /** Maps `meter → error message` for failed reports. */
  errors: Partial<Record<UsageMeter, string>>;
}

/**
 * Result of running overage invoicing for a single tenant.
 */
export interface OverageInvoicingResult {
  tenantId: string;
  totalOverageItems: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Maps `meter → stripeInvoiceItemId` for reporting. */
  invoiceItemIds: Record<UsageMeter, string | null>;
  /** Total amount invoiced (sum across all meters, in major units). */
  totalAmount: DecimalString;
  /** Maps `meter → error message` for failed overage items. */
  errors: Partial<Record<UsageMeter, string>>;
}

/** DTO returned by `POST /api/admin/usage/sync-now`. */
export interface SyncNowResult {
  periodStart: string;
  periodEnd: string;
  totalTenants: number;
  totalReports: number;
  succeeded: number;
  failed: number;
  /** Tenant-level breakdowns (capped to first 50 for the admin UI). */
  tenants: MonthlyReportResult[];
}

/** DTO returned by `GET /api/admin/usage/tenants/:id`. */
export interface TenantUsageSummary {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  meters: Array<{
    meter: UsageMeter;
    daily: DailyUsageRow[];
    monthly: UsageReportRow | null;
    overage: OverageRow | null;
  }>;
}

/** Re-export of the Prisma row type for tests that need it. */
export type { TenantUsageDaily, TenantUsageEvent };