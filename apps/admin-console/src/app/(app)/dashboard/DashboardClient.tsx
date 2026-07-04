'use client';

/**
 * DashboardClient — client-side wrapper that owns the metrics fetch
 * hook and renders the KPI grid + 3 charts.
 *
 * Why a separate client component (DashboardClient) instead of putting
 * it all in the page? — `page.tsx` stays a server component (so its
 * `metadata` export works and the layout's server-side auth gate is
 * the single auth boundary). The client piece does the live-fetch
 * work that needs React hooks.
 */

import * as React from 'react';
import { Building2, CircleDollarSign, Database, LayoutDashboard, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/dashboard/StatCard';
import { ApiVolumeCard } from '@/components/dashboard/ApiVolumeCard';
import { TenantGrowthChart } from '@/components/dashboard/TenantGrowthChart';
import { RevenueByPlanChart } from '@/components/dashboard/RevenueByPlanChart';
import { TopStorageChart } from '@/components/dashboard/TopStorageChart';
import { DashboardErrorBanner } from '@/components/dashboard/DashboardErrorBanner';
import { useDashboardMetrics } from '@/lib/use-dashboard-metrics';
import {
  formatBytes,
  formatCount,
  formatDelta,
  formatMoneyCents,
  formatRelativeTime,
} from '@/lib/metrics-format';
import type { DashboardMetrics } from '@omyxia/shared-types';

interface DashboardClientProps {
  /** Refresh cadence in ms. Defaults to 5 minutes in the hook. */
  refreshMs?: number;
}

export function DashboardClient({ refreshMs = 5 * 60 * 1000 }: DashboardClientProps) {
  const { state, refresh, lastFetchedAt } = useDashboardMetrics({ refreshMs });

  const metrics: DashboardMetrics | undefined =
    state.kind === 'ok' ? state.metrics : state.kind === 'loading' ? state.previous : undefined;
  const loading = state.kind === 'loading' && !metrics;
  const refreshing = state.kind === 'loading' && Boolean(metrics);

  // Derive KPI deltas (24h-only metric; we compute "net adds last 7d" delta
  // from the payload).
  const tenantDelta = metrics
    ? formatDelta(metrics.tenants.netAddsLast7d)
    : undefined;

  // 24h API delta is approximated from 7d average (no per-day breakdown in
  // payload).  We surface the raw 24h vs (7d / 7) and avoid faking a
  // delta we don't have data for.
  const apiDelta = metrics
    ? (() => {
        const expectedDaily = metrics.apiVolume.last7d / 7;
        const diff = metrics.apiVolume.last24h - expectedDaily;
        const tone: 'up' | 'down' | 'flat' =
          Math.abs(diff) < expectedDaily * 0.05
            ? 'flat'
            : diff > 0
            ? 'up'
            : 'down';
        return { label: `${tone === 'up' ? '+' : tone === 'down' ? '' : ''}${Math.round((diff / Math.max(expectedDaily, 1)) * 100)}%`, tone };
      })()
    : undefined;

  return (
    <div className="space-y-6" data-testid="page-dashboard">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="h-5 w-5" aria-hidden />
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            High-level overview of tenants, plans, and platform health.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">P2.2</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
            data-testid="dashboard-refresh"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {state.kind === 'error' ? (
        <DashboardErrorBanner
          error={state.error}
          onRetry={() => void refresh()}
          hasPreviousData={Boolean(state.previous)}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tenants"
          value={metrics ? formatCount(metrics.tenants.total) : '—'}
          tone="primary"
          icon={<Building2 className="h-4 w-4" aria-hidden />}
          loading={loading}
          testId="stat-tenants"
          delta={tenantDelta ? { ...tenantDelta, caption: 'last 7 days' } : undefined}
          hint={
            metrics ? (
              <span data-testid="stat-tenants-breakdown">
                {formatCount(metrics.tenants.active)} active ·{' '}
                {formatCount(metrics.tenants.suspended)} suspended ·{' '}
                {formatCount(metrics.tenants.archived)} archived
              </span>
            ) : (
              'Total tenant accounts'
            )
          }
        />

        <StatCard
          label="MRR"
          value={metrics ? formatMoneyCents(metrics.mrr.totalCents) : '—'}
          tone="success"
          icon={<CircleDollarSign className="h-4 w-4" aria-hidden />}
          loading={loading}
          testId="stat-mrr"
          hint={
            metrics ? (
              <span data-testid="stat-mrr-breakdown">
                Pro {formatMoneyCents(metrics.mrr.byPlan.PRO)} · Ent{' '}
                {formatMoneyCents(metrics.mrr.byPlan.ENTERPRISE)}
              </span>
            ) : (
              'Monthly recurring revenue'
            )
          }
        />

        <StatCard
          label="Storage"
          value={metrics ? formatBytes(metrics.storage.totalBytes, 1) : '—'}
          tone="warning"
          icon={<Database className="h-4 w-4" aria-hidden />}
          loading={loading}
          testId="stat-storage"
          hint={
            metrics
              ? `${Math.min(100, Math.round((metrics.storage.totalBytes / metrics.storage.quotaBytes) * 100))}% of ${formatBytes(metrics.storage.quotaBytes, 0)} quota`
              : 'Across all tenants'
          }
        />

        <ApiVolumeCard
          apiVolume={
            metrics?.apiVolume ?? {
              last24h: 0,
              last7d: 0,
              last30d: 0,
              hourlySeries24h: [],
            }
          }
          delta24h={apiDelta}
          generatedAt={lastFetchedAt ?? metrics?.generatedAt}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TenantGrowthChart series={metrics?.tenantGrowth ?? { days: 0, points: [] }} loading={loading} />
        <RevenueByPlanChart
          slices={metrics?.revenueByPlan ?? []}
          totalCents={metrics?.mrr.totalCents ?? 0}
          loading={loading}
        />
      </div>

      <TopStorageChart storage={metrics?.storage ?? { totalBytes: 0, quotaBytes: 0, topTenants: [] }} loading={loading} />

      <p className="text-xs text-muted-foreground" data-testid="dashboard-footer">
        {lastFetchedAt
          ? `Last updated ${formatRelativeTime(lastFetchedAt)} · auto-refresh every ${Math.round(refreshMs / 60000)} min`
          : 'Data auto-refreshes every 5 minutes.'}
      </p>
    </div>
  );
}
