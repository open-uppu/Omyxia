'use client';

/**
 * RevenueByPlanChart — pie chart of MRR by plan.
 *
 * The Free plan contributes $0 (filtered out by the API). The
 * remaining slices come from the backend `revenueByPlan` array which
 * already carries the colour and share precomputed — the renderer
 * just maps them to Recharts Cells.
 */

import * as React from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { CircleDollarSign } from 'lucide-react';
import { formatMoneyCents, formatShare } from '@/lib/metrics-format';
import type { RevenueShare } from '@omyxia/shared-types';

interface RevenueByPlanChartProps {
  slices: RevenueShare[];
  loading?: boolean;
  totalCents: number;
}

export function RevenueByPlanChart({ slices, totalCents, loading }: RevenueByPlanChartProps) {
  const visible = slices.filter((s) => s.monthlyCents > 0);

  return (
    <Card data-testid="chart-revenue-by-plan">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleDollarSign className="h-4 w-4" aria-hidden />
          Revenue by plan
        </CardTitle>
        <CardDescription>
          MRR contribution per plan · Total {formatMoneyCents(totalCents)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            data-testid="chart-revenue-by-plan-skeleton"
            className="h-64 w-full animate-pulse rounded-md bg-muted"
          />
        ) : visible.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No recurring revenue yet.
          </div>
        ) : (
          <div className="h-64" data-testid="chart-revenue-by-plan-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visible}
                  dataKey="monthlyCents"
                  nameKey="label"
                  innerRadius={60}
                  outerRadius={92}
                  paddingAngle={2}
                  isAnimationActive={false}
                >
                  {visible.map((slice) => (
                    <Cell key={slice.plan} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const slice = payload[0]?.payload as RevenueShare | undefined;
                    if (!slice) return null;
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                        <div className="font-medium">{slice.label}</div>
                        <div className="text-muted-foreground tabular-nums">
                          {formatMoneyCents(slice.monthlyCents)} ({formatShare(slice.share)})
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value, entry) => {
                    const slice = (entry as { payload?: RevenueShare }).payload;
                    if (!slice) return String(value);
                    return `${slice.label} · ${formatMoneyCents(slice.monthlyCents)}`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
