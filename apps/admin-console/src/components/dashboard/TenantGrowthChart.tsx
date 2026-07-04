'use client';

/**
 * TenantGrowthChart — 30-day line chart for active / suspended tenants.
 *
 * Two stacked areas:
 *   - "Active tenants" (primary)
 *   - "Suspended tenants" (red, on top, much smaller)
 *
 * Recharts components are client-side only — this whole file is
 * client-only. The card it lives in (parent) is already a client
 * component, so this is fine.
 */

import * as React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import { Users } from 'lucide-react';
import { formatShortDate } from '@/lib/metrics-format';
import type { TenantGrowthSeries } from '@omyxia/shared-types';

interface TenantGrowthChartProps {
  series: TenantGrowthSeries;
  loading?: boolean;
}

export function TenantGrowthChart({ series, loading }: TenantGrowthChartProps) {
  return (
    <Card data-testid="chart-tenant-growth">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" aria-hidden />
            Tenant growth — last {series.days} days
          </CardTitle>
          <CardDescription>Active vs suspended tenants, daily.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            data-testid="chart-tenant-growth-skeleton"
            className="h-64 w-full animate-pulse rounded-md bg-muted"
          />
        ) : (
          <div className="h-64" data-testid="chart-tenant-growth-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series.points}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  minTickGap={28}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                        <div className="mb-1 font-medium">{formatShortDate(String(label ?? ''))}</div>
                        {payload.map((p) => (
                          <div
                            key={String(p.dataKey)}
                            className="flex items-center gap-2 tabular-nums"
                          >
                            <span
                              aria-hidden
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: String(p.color) }}
                            />
                            <span className="text-muted-foreground">{p.name}:</span>
                            <span className="font-medium">{String(p.value ?? 0)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                  iconType="circle"
                  iconSize={8}
                />
                <Line
                  type="monotone"
                  name="Active"
                  dataKey="active"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  name="Suspended"
                  dataKey="suspended"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
