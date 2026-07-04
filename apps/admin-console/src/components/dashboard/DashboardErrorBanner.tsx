'use client';

/**
 * DashboardErrorBanner — shown above the KPI grid when the metrics
 * fetch failed. We keep the previously-loaded data visible (passed
 * via `previous`) so a transient upstream glitch doesn't blank the
 * dashboard — important for the 5-min auto-refresh cadence.
 */

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface DashboardErrorBannerProps {
  error: string;
  onRetry?: () => void;
  hasPreviousData: boolean;
}

export function DashboardErrorBanner({ error, onRetry, hasPreviousData }: DashboardErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid="dashboard-error"
      className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">
          {hasPreviousData ? 'Could not refresh dashboard metrics.' : 'Failed to load dashboard metrics.'}
        </div>
        <div className="text-xs text-muted-foreground">{error}</div>
      </div>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          data-testid="dashboard-retry"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
