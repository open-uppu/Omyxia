/**
 * Tests for the deterministic DashboardMetrics mock generator.
 *
 * The mock is the dashboard's ONLY data source in dev mode, so
 * these tests guard:
 *
 *   - Determinism — same day + window → same numbers.
 *   - Schema compliance — every field passes the shared-types zod
 *     schema (otherwise the dashboard crashes on parse).
 *   - Range sanity — counts/percentages stay in physical bounds
 *     (e.g. share sums to <= 1, plan totals add up to grand total).
 *
 * These are pure-data tests (no React, no fetch) — fast and stable.
 */

import { describe, expect, it } from 'vitest';
import {
  DashboardMetricsSchema,
  AdminAggregationWindowSchema,
} from '@omyxia/shared-types';
import { generateMockMetrics } from './metrics-mock';

describe('AdminAggregationWindowSchema', () => {
  it('only allows the three documented windows', () => {
    expect(AdminAggregationWindowSchema.options).toEqual(['24h', '7d', '30d']);
  });
});

describe('generateMockMetrics', () => {
  const fixedNow = new Date('2026-07-04T10:00:00.000Z');

  it('returns a schema-valid payload for every window', () => {
    for (const window of AdminAggregationWindowSchema.options) {
      const metrics = generateMockMetrics(window, fixedNow);
      const parsed = DashboardMetricsSchema.safeParse(metrics);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });

  it('is deterministic across calls (same day + window)', () => {
    const a = generateMockMetrics('24h', fixedNow);
    const b = generateMockMetrics('24h', fixedNow);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('uses the provided clock for generatedAt', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    expect(metrics.generatedAt).toBe(fixedNow.toISOString());
  });

  it('keeps tenant counts internally consistent', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    const { total, active, suspended, archived } = metrics.tenants;
    expect(total).toBe(active + suspended + archived);
    for (const v of [total, active, suspended, archived]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
    // Sanity bounds so we don't accidentally return zero / wildly huge values.
    expect(total).toBeGreaterThan(0);
  });

  it('builds MRR such that byPlan sums to totalCents', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    const { byPlan, totalCents } = metrics.mrr;
    expect(byPlan.FREE + byPlan.PRO + byPlan.ENTERPRISE).toBe(totalCents);
    expect(totalCents).toBeGreaterThanOrEqual(0);
  });

  it('excludes Free from revenueByPlan slices (share sums to 1)', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    const plans = new Set(metrics.revenueByPlan.map((s) => s.plan));
    expect(plans.has('FREE')).toBe(false);

    const sum = metrics.revenueByPlan.reduce((acc, s) => acc + s.share, 0);
    // Each share is a precomputed 0..1 fraction; allow tiny float drift.
    expect(Math.abs(sum - 1)).toBeLessThan(0.005);
  });

  it('produces 24 hourly points in hourlySeries24h, in ascending hour order', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    const series = metrics.apiVolume.hourlySeries24h;
    expect(series).toHaveLength(24);
    for (let i = 1; i < series.length; i++) {
      const a = new Date(series[i - 1]!.hour).getTime();
      const b = new Date(series[i]!.hour).getTime();
      expect(b).toBeGreaterThanOrEqual(a);
    }
  });

  it('keeps totalBytes <= quotaBytes (otherwise quota % would exceed 100)', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    expect(metrics.storage.totalBytes).toBeLessThanOrEqual(metrics.storage.quotaBytes);
  });

  it('produces 30 daily tenant-growth points in ascending date order', () => {
    const metrics = generateMockMetrics('24h', fixedNow);
    expect(metrics.tenantGrowth.days).toBe(30);
    expect(metrics.tenantGrowth.points).toHaveLength(30);
    for (let i = 1; i < metrics.tenantGrowth.points.length; i++) {
      expect(
        new Date(metrics.tenantGrowth.points[i]!.date).getTime()
      ).toBeGreaterThanOrEqual(new Date(metrics.tenantGrowth.points[i - 1]!.date).getTime());
    }
  });
});
