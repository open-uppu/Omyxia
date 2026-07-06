/**
 * Dashboard metrics wire format (shared between the admin-console
 * frontend and any backend producer).
 *
 * Lives in @omyxia/shared-types so:
 *   - The frontend can validate shapes at runtime (zod).
 *   - The future backend admin metrics endpoint (P1.4+ time-series
 *     expansions) can return the same shape verbatim.
 *
 * Conventions:
 *   - All amounts are numbers in the canonical unit (USD cents for
 *     money, bytes for storage). Display formatters in the frontend
 *     divide / format.
 *   - All counts are integers >= 0.
 *   - Time-series `date` fields are ISO 8601 strings (`YYYY-MM-DD`
 *     for daily buckets, full ISO for 24h hourly buckets).
 *
 * This module is intentionally pure-data — no React, no hooks, no
 * environment reads — so it can be imported from both the React tree
 * and the Node API route handlers.
 */

import { z } from 'zod';

// ----------------------------------------------------------------------------
// Plan + status enums (mirrors the backend DB enums in P1.1)
// ----------------------------------------------------------------------------

export const AdminPlanSlugSchema = z.enum(['FREE', 'PRO', 'ENTERPRISE']);
export type AdminPlanSlug = z.infer<typeof AdminPlanSlugSchema>;

export const AdminTenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
export type AdminTenantStatus = z.infer<typeof AdminTenantStatusSchema>;

// ----------------------------------------------------------------------------
// Aggregation windows — KPI cards (storage, API calls) are configurable
// across 24h / 7d / 30d windows. The dashboard exposes a toggle.
// ----------------------------------------------------------------------------

export const AdminAggregationWindowSchema = z.enum(['24h', '7d', '30d']);
export type AdminAggregationWindow = z.infer<typeof AdminAggregationWindowSchema>;

// ----------------------------------------------------------------------------
// KPI snapshots
// ----------------------------------------------------------------------------

/** Total tenants split by status. Counts never overlap (a tenant is
 *  exactly ACTIVE, SUSPENDED, or ARCHIVED at any moment). */
export const TenantCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  suspended: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  /** Net adds in the last 7 days (active - churned). May be negative. */
  netAddsLast7d: z.number().int(),
});
export type TenantCounts = z.infer<typeof TenantCountsSchema>;

/** MRR breakdown by plan + total. `monthlyCents` is the recurring
 *  portion only — proration / one-time fees are NOT included. */
export const MrrBreakdownSchema = z.object({
  totalCents: z.number().int().nonnegative(),
  byPlan: z.object({
    FREE: z.number().int().nonnegative(),
    PRO: z.number().int().nonnegative(),
    ENTERPRISE: z.number().int().nonnegative(),
  }),
  /** Sorted descending by cents; useful for sorting chart slices
   *  without re-computing in the renderer. */
  plansRanked: z.array(AdminPlanSlugSchema),
  /** Currency code for display. Defaults to USD; reserved for future
   *  multi-currency support. */
  currency: z.literal('USD'),
  /** Period — calendar-month to date is the v0.1 default. */
  period: z.enum(['mrr', 'arr']),
});
export type MrrBreakdown = z.infer<typeof MrrBreakdownSchema>;

/** Storage usage (all tenants summed). Reported in GiB but the wire
 *  format is bytes (1 GiB = 1024 * 1024 * 1024) so the renderer never
 *  loses precision. The display formatter converts. */
export const StorageUsageSchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().nonnegative(),
  /** Top N tenants by storage. N defaults to 10 on the backend; the
   *  dashboard shows a `barChart` of these. */
  topTenants: z.array(
    z.object({
      tenantId: z.string(),
      tenantName: z.string(),
      bytes: z.number().int().nonnegative(),
      plan: AdminPlanSlugSchema,
    })
  ),
});
export type StorageUsage = z.infer<typeof StorageUsageSchema>;

/** API call counts in fixed windows. The backend may have finer
 *  granularity internally; the admin dashboard renders at most these
 *  three windows. */
export const ApiVolumeSchema = z.object({
  last24h: z.number().int().nonnegative(),
  last7d: z.number().int().nonnegative(),
  last30d: z.number().int().nonnegative(),
  /** 24h hourly series (24 points). Enables the "today" sparkline. */
  hourlySeries24h: z.array(
    z.object({
      /** ISO timestamp at the top of the hour, UTC. */
      hour: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
});
export type ApiVolume = z.infer<typeof ApiVolumeSchema>;

// ----------------------------------------------------------------------------
// Chart series
// ----------------------------------------------------------------------------

/** Tenant growth — last 30 days, daily bucket. */
export const TenantGrowthPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  active: z.number().int().nonnegative(),
  suspended: z.number().int().nonnegative(),
});
export type TenantGrowthPoint = z.infer<typeof TenantGrowthPointSchema>;

export const TenantGrowthSeriesSchema = z.object({
  days: z.number().int().positive(),
  points: z.array(TenantGrowthPointSchema),
});
export type TenantGrowthSeries = z.infer<typeof TenantGrowthSeriesSchema>;

/** Revenue by plan — pie chart. `share` is precomputed so the renderer
 *  does not have to know about totals. */
export const RevenueShareSchema = z.object({
  plan: AdminPlanSlugSchema,
  /** Display name (e.g. "Pro — $29/mo"). Backend canonicalises. */
  label: z.string(),
  monthlyCents: z.number().int().nonnegative(),
  /** 0..1, sums to <= 1 across plans (free plan = 0 revenue, omitted). */
  share: z.number().min(0).max(1),
  /** Hex colour. The dashboard palette assigns these. */
  color: z.string(),
});
export type RevenueShare = z.infer<typeof RevenueShareSchema>;

// ----------------------------------------------------------------------------
// Top-level payload — one response is everything the dashboard needs.
// ----------------------------------------------------------------------------

export const DashboardMetricsSchema = z.object({
  generatedAt: z.string(), // ISO timestamp — useful for "Last updated …"
  window: AdminAggregationWindowSchema,
  tenants: TenantCountsSchema,
  mrr: MrrBreakdownSchema,
  storage: StorageUsageSchema,
  apiVolume: ApiVolumeSchema,
  /** Charts. */
  tenantGrowth: TenantGrowthSeriesSchema,
  revenueByPlan: z.array(RevenueShareSchema),
});
export type DashboardMetrics = z.infer<typeof DashboardMetricsSchema>;
