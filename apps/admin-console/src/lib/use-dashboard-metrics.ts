'use client';

/**
 * useDashboardMetrics — fetch + auto-refresh hook for the admin dashboard.
 *
 * Responsibilities:
 *   - Fetch /api/admin/metrics?window=24h|7d|30d.
 *   - Auto-refresh every `refreshMs` (default 5 min — matches the card
 *     spec; can be overridden for tests).
 *   - Pause while the document is hidden (visibilityState === 'hidden')
 *     to avoid wasted requests when the admin is on another tab.
 *   - Expose load/error/refresh state for the KPI cards and charts.
 *
 * Why a hook instead of a server fetch?
 *   - The dashboard NEEDS to refresh without a full page reload (5 min
 *     cadence — feels worse as a hard reload).
 *   - The toggle (24h/7d/30d) is client-side state.
 *   - Recharts components are client-only and need a hydrated payload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardMetrics, AdminAggregationWindow } from '@omyxia/shared-types';

const DEFAULT_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

interface UseDashboardMetricsOptions {
  /** Initial window. Switchable at runtime via `setWindow`. */
  initialWindow?: AdminAggregationWindow;
  /** Refresh cadence in ms. Pass 0 to disable auto-refresh. */
  refreshMs?: number;
  /** Disable the hook (e.g. when there is no admin session yet). */
  enabled?: boolean;
}

export type MetricsState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous?: DashboardMetrics }
  | { kind: 'ok'; metrics: DashboardMetrics }
  | { kind: 'error'; error: string; previous?: DashboardMetrics };

export interface UseDashboardMetricsReturn {
  state: MetricsState;
  window: AdminAggregationWindow;
  setWindow: (w: AdminAggregationWindow) => void;
  refresh: () => Promise<void>;
  /** Last time the data was successfully fetched (ISO string). */
  lastFetchedAt: string | null;
}

export function useDashboardMetrics(
  options: UseDashboardMetricsOptions = {}
): UseDashboardMetricsReturn {
  const {
    initialWindow = '24h',
    refreshMs = DEFAULT_REFRESH_MS,
    enabled = true,
  } = options;

  const [aggregationWindow, setAggregationWindow] = useState<AdminAggregationWindow>(initialWindow);
  const [state, setState] = useState<MetricsState>({ kind: 'idle' });
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  // Hold the fetch in a ref so the timer can read the current
  // window without re-subscribing on every state change.
  const fetchRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(async () => {
    return fetchRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function doFetch(): Promise<void> {
      // Mark the request so the UI can show a "refreshing" indicator
      // instead of a full skeleton on subsequent refreshes.
      setState((prev) =>
        prev.kind === 'ok'
          ? { kind: 'loading', previous: prev.metrics }
          : { kind: 'loading' }
      );
      try {
        const res = await fetch(
          `/api/admin/metrics?window=${encodeURIComponent(aggregationWindow)}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          }
        );
        if (cancelled) return;
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') detail = body.error;
          } catch {
            // Ignore JSON parse errors here — `detail` already has a status.
          }
          setState((prev) =>
            prev.kind === 'ok'
              ? { kind: 'error', error: detail, previous: prev.metrics }
              : { kind: 'error', error: detail }
          );
          return;
        }
        const metrics = (await res.json()) as DashboardMetrics;
        if (cancelled) return;
        setState({ kind: 'ok', metrics });
        setLastFetchedAt(new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Network error';
        setState((prev) =>
          prev.kind === 'ok'
            ? { kind: 'error', error: message, previous: prev.metrics }
            : { kind: 'error', error: message }
        );
      }
    }

    fetchRef.current = doFetch;

    // Immediate first fetch.
    void doFetch();

    if (refreshMs <= 0) {
      return () => {
        cancelled = true;
      };
    }

    // Auto-refresh cadence, gated on visibility.
    function isVisible(): boolean {
      return typeof document === 'undefined' || document.visibilityState !== 'hidden';
    }

    function tick(): void {
      if (!isVisible()) return;
      void doFetch();
    }

    const intervalId = window.setInterval(tick, refreshMs);
    const visibilityListener = () => {
      // When the tab becomes visible again after being hidden, refresh
      // immediately so the displayed "Last updated" isn't stale.
      if (isVisible()) void doFetch();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibilityListener);
    }

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityListener);
      }
    };
  }, [aggregationWindow, refreshMs, enabled]);

  return {
    state,
    window: aggregationWindow,
    setWindow: setAggregationWindow,
    refresh,
    lastFetchedAt,
  };
}
