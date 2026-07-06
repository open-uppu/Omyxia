'use client';

/**
 * StatCard — primitive KPI tile used by the dashboard.
 *
 * Layout: icon (optional) + label + large value + optional delta chip.
 *
 * Variants via `tone` change the accent colour of the icon + delta chip
 * — useful to colour-code metric families (tenants = primary, MRR =
 * success, storage = warning, API = accent) without inventing new
 * design tokens.
 */

import * as React from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export type StatTone = 'primary' | 'success' | 'warning' | 'accent' | 'muted';

const toneAccentClass: Record<StatTone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  muted: 'bg-muted text-muted-foreground',
};

export type StatDelta = {
  label: string;
  tone: 'up' | 'down' | 'flat';
  /** Optional human-readable caption — shown below the delta. */
  caption?: string;
};

interface StatCardProps {
  label: string;
  value: string;
  /** Lucide node, typically an icon component. */
  icon?: React.ReactNode;
  tone?: StatTone;
  delta?: StatDelta;
  /** Context text below the value (e.g. quota denominator). */
  hint?: React.ReactNode;
  /** Footer slot — for breakdown rows, mini-chart, etc. */
  footer?: React.ReactNode;
  /** Loading shimmer — shows a skeleton instead of the value. */
  loading?: boolean;
  /** Test id root. */
  testId?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  delta,
  hint,
  footer,
  loading = false,
  testId,
  className,
}: StatCardProps) {
  return (
    <Card data-testid={testId ?? `stat-${label.toLowerCase().replace(/\s+/g, '-')}`} className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-sm font-medium">{label}</CardDescription>
        {icon ? (
          <span
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md',
              toneAccentClass[tone]
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? (
          <div
            data-testid={`${testId ?? 'stat'}-skeleton`}
            className="h-8 w-32 animate-pulse rounded-md bg-muted"
          />
        ) : (
          <div
            className="text-3xl font-semibold tracking-tight tabular-nums"
            data-testid={`${testId ?? 'stat'}-value`}
          >
            {value}
          </div>
        )}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {delta ? (
          <div className="flex items-center gap-1.5 pt-1">
            <Badge
              variant={
                delta.tone === 'up'
                  ? 'success'
                  : delta.tone === 'down'
                  ? 'destructive'
                  : 'secondary'
              }
            >
              {delta.tone === 'up' ? <ArrowUp className="mr-1 h-3 w-3" /> : null}
              {delta.tone === 'down' ? <ArrowDown className="mr-1 h-3 w-3" /> : null}
              {delta.tone === 'flat' ? <ArrowRight className="mr-1 h-3 w-3" /> : null}
              {delta.label}
            </Badge>
            {delta.caption ? (
              <span className="text-xs text-muted-foreground">{delta.caption}</span>
            ) : null}
          </div>
        ) : null}
        {footer ? <div className="pt-2">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
