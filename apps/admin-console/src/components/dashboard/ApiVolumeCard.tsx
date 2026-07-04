'use client';

/**
 * The API Volume card — distinct from a plain StatCard because it
 * carries a 24h / 7d / 30d window toggle that switches which metric
 * the badge shows.
 *
 * Visual:
 *   +-----------------------+
 *   | API calls    [24h ▾]  | <- window picker (group of 3 buttons)
 *   |                       |
 *   |  231,402              | <- large value (chosen window)
 *   |  ─────────╱╲──╱─────  | <- mini sparkline of the hourly 24h series
 *   |  24h 7d 30d bands     |
 *   +-----------------------+
 *
 * The sparkline is rendered with Recharts (small wrapper) so the
 * line style matches the full tenant-growth chart.
 */

import * as React from 'react';
import { Activity } from 'lucide-react';
import { StatCard, type StatDelta } from './StatCard';
import {
  API_WINDOW_OPTIONS,
  type ApiWindowOption,
} from './api-windows';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  formatCount,
  formatRelativeTime,
} from '@/lib/metrics-format';
import type { ApiVolume } from '@omyxia/shared-types';

interface ApiVolumeCardProps {
  apiVolume: ApiVolume;
  /** Sticky across all windows — usually a 24h delta. */
  delta24h?: StatDelta;
  /** Optional "last updated" caption. */
  generatedAt?: string;
  loading?: boolean;
}

export function ApiVolumeCard({ apiVolume, delta24h, generatedAt, loading }: ApiVolumeCardProps) {
  const [window, setWindow] = React.useState<ApiWindowOption>('24h');

  const valueByWindow: Record<ApiWindowOption, number> = {
    '24h': apiVolume.last24h,
    '7d': apiVolume.last7d,
    '30d': apiVolume.last30d,
  };

  const value = valueByWindow[window];

  return (
    <StatCard
      label="API calls"
      value={formatCount(value, { compact: window !== '24h' })}
      tone="accent"
      icon={<Activity className="h-4 w-4" aria-hidden />}
      loading={loading}
      testId="stat-api"
      delta={window === '24h' ? delta24h : undefined}
      hint={
        <span data-testid="stat-api-generated">
          {generatedAt ? `Updated ${formatRelativeTime(generatedAt)}` : 'Auto-refresh every 5 min'}
        </span>
      }
      footer={
        <div className="space-y-3">
          <div
            role="tablist"
            aria-label="API call window"
            className="inline-flex h-8 items-center rounded-md border bg-muted/50 p-0.5 text-xs"
            data-testid="stat-api-window"
          >
            {API_WINDOW_OPTIONS.map((opt) => {
              const active = opt === window;
              return (
                <button
                  key={opt}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`stat-api-window-${opt}`}
                  onClick={() => setWindow(opt)}
                  className={cn(
                    'inline-flex h-7 items-center justify-center rounded px-2.5 font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    active
                      ? 'bg-background text-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <div className="h-14" data-testid="stat-api-spark">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={apiVolume.hourlySeries24h} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="apiSparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hour" hide />
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const item = payload[0]?.payload as { hour: string; count: number } | undefined;
                    if (!item) return null;
                    const hourDate = new Date(item.hour);
                    const hh = Number.isNaN(hourDate.getTime())
                      ? item.hour
                      : hourDate.toISOString().slice(11, 16) + ' UTC';
                    return (
                      <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
                        <div className="font-medium">{hh}</div>
                        <div className="text-muted-foreground tabular-nums">
                          {formatCount(item.count)} req
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  fill="url(#apiSparkFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      }
    />
  );
}
