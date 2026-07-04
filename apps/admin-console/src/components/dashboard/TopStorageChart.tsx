'use client';

/**
 * TopStorageChart — horizontal bar chart of the top 10 storage users.
 *
 * Recharts `BarChart` with `layout="vertical"` gives us horizontal
 * bars with tenant names on the y-axis and GiB on the x-axis. The
 * bar colour is keyed to the tenant's plan (via the payload field).
 */

import * as React from 'react';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { HardDrive } from 'lucide-react';
import { formatBytes } from '@/lib/metrics-format';
import type { StorageUsage } from '@omyxia/shared-types';

const PLAN_COLOR: Record<string, string> = {
  FREE: '#94a3b8', // slate-400
  PRO: '#3b82f6', // blue-500
  ENTERPRISE: '#8b5cf6', // violet-500
};

interface TopStorageChartProps {
  storage: StorageUsage;
  loading?: boolean;
}

export function TopStorageChart({ storage, loading }: TopStorageChartProps) {
  // Order descending — the heaviest user sits at index 0. Recharts
  // `layout="vertical"` plots index 0 at the BOTTOM by default, so to
  // show "biggest at top" we present the sorted array as-is and rely
  // on `reversedStackOrder` below to flip the visual order.
  const data = [...storage.topTenants].sort((a, b) => b.bytes - a.bytes);

  return (
    <Card data-testid="chart-top-storage">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="h-4 w-4" aria-hidden />
          Top storage users
        </CardTitle>
        <CardDescription>
          Heaviest 10 tenants · Total {formatBytes(storage.totalBytes, 1)} of{' '}
          {formatBytes(storage.quotaBytes, 1)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            data-testid="chart-top-storage-skeleton"
            className="h-72 w-full animate-pulse rounded-md bg-muted"
          />
        ) : data.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            No storage data.
          </div>
        ) : (
          <div className="h-72" data-testid="chart-top-storage-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                reverseStackOrder
                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                barCategoryGap={6}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(v) => formatBytes(typeof v === 'number' ? v : Number(v), 1)}
                />
                <YAxis
                  type="category"
                  dataKey="tenantName"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  width={140}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const item = payload[0]?.payload as
                      | { tenantName: string; bytes: number; plan: string }
                      | undefined;
                    if (!item) return null;
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                        <div className="font-medium">{item.tenantName}</div>
                        <div className="text-muted-foreground">
                          <span className="tabular-nums">{formatBytes(item.bytes, 2)}</span>{' '}
                          <span className="ml-1 text-[10px] uppercase tracking-wide">
                            {item.plan}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="bytes" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {data.map((row) => (
                    <Cell key={row.tenantId} fill={PLAN_COLOR[row.plan] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!loading && data.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground"
            data-testid="chart-top-storage-legend"
          >
            {(['ENTERPRISE', 'PRO', 'FREE'] as const).map((plan) => (
              <span key={plan} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: PLAN_COLOR[plan] ?? '#64748b' }}
                />
                {plan}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
