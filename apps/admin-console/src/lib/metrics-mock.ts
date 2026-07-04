/**
 * Deterministic mock generator for DashboardMetrics.
 *
 * Why deterministic? — The dev shell uses this to populate the
 * dashboard without a backend running. Deterministic (seeded) numbers
 * mean:
 *   - Visual smoke tests are stable across runs.
 *   - Tests can assert against fixed snapshots.
 *   - The rendered UI does not jitter on every refresh.
 *
 * The seed is itself derived from the `window` parameter so flipping
 * the 24h/7d/30d toggle produces a *related but distinct* snapshot.
 *
 * Scope: this file is intentionally inside the admin-console app (not
 * shared-types) because it is a stub for the dashboard only — when
 * the real P2.2 backend lands, this whole file is deleted and the
 * route proxies to /admin/metrics on the API.
 */

import type {
  DashboardMetrics,
  AdminAggregationWindow,
  RevenueShare,
  TenantGrowthPoint,
  AdminPlanSlug,
} from '@omyxia/shared-types';
import { addDays, addHours, formatISO, startOfDay } from 'date-fns';

/** Small, fast, stable 32-bit PRNG (mulberry32). Public domain. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const PLAN_LABELS: Record<AdminPlanSlug, string> = {
  FREE: 'Free — $0',
  PRO: 'Pro — $29',
  ENTERPRISE: 'Enterprise — $299',
};

const PLAN_COLORS: Record<AdminPlanSlug, string> = {
  FREE: '#94a3b8', // slate-400
  PRO: '#3b82f6', // blue-500
  ENTERPRISE: '#8b5cf6', // violet-500
};

const PLAN_PRICES_CENTS: Record<AdminPlanSlug, number> = {
  FREE: 0,
  PRO: 2900,
  ENTERPRISE: 29900,
};

/** Names pool for the top-storage tenants. Curated to look realistic. */
const TENANT_NAME_POOL = [
  'Acme Holdings',
  'Globex Logistics',
  'Initech Software',
  'Umbrella Pharma',
  'Stark Industries',
  'Wayne Enterprises',
  'Cyberdyne Systems',
  'Soylent Foods',
  'Tyrell Corp',
  'Massive Dynamic',
  'Nakatomi Trading',
  'Aperture Science',
  'Black Mesa',
  'Vandelay Imports',
  'Hooli Networks',
];

/**
 * Build a stable mock DashboardMetrics payload.
 *
 * - `window` selects which API-volume series is highlighted but does
 *   NOT change the per-card value (the cards always show
 *   24h/7d/30d in toggleable sub-rows).
 * - `now` lets tests fix a specific instant; production passes
 *   `new Date()`.
 */
export function generateMockMetrics(
  window: AdminAggregationWindow,
  now: Date = new Date()
): DashboardMetrics {
  const seed = hashSeed(`dashboard:${window}:${formatISO(startOfDay(now), { representation: 'date' })}`);
  const rand = mulberry32(seed);

  // ---- Tenant counts ------------------------------------------------------
  // Healthy mix: ~120 active, ~12 suspended, ~88 archived; delta intent.
  const active = 100 + Math.floor(rand() * 60); // 100..159
  const suspended = 8 + Math.floor(rand() * 10); // 8..17
  const archived = 60 + Math.floor(rand() * 70); // 60..129
  const total = active + suspended + archived;
  const netAddsLast7d = Math.floor(rand() * 14) - 4; // -4..9

  // ---- MRR ----------------------------------------------------------------
  // Pro is the dominant plan; Enterprise a smaller but high-value tail.
  const proCount = Math.floor(active * (0.55 + rand() * 0.1));
  const enterpriseCount = Math.floor(active * (0.08 + rand() * 0.04));
  const freeCount = active - proCount - enterpriseCount;
  const proCents = proCount * PLAN_PRICES_CENTS.PRO;
  const enterpriseCents = enterpriseCount * PLAN_PRICES_CINTS();
  // (helper to keep the line above readable)
  function PLAN_PRICES_CINTS(): number { return PLAN_PRICES_CENTS.ENTERPRISE; }
  const totalCents = proCents + enterpriseCents;
  const ranks: AdminPlanSlug[] = (Object.entries({
    FREE: 0,
    PRO: proCents,
    ENTERPRISE: enterpriseCents,
  }) as [AdminPlanSlug, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  // ---- Revenue-by-plan (pie chart) ---------------------------------------
  const revenueByPlan: RevenueShare[] = ranks
    .filter((plan) => plan !== 'FREE')
    .map((plan) => {
      const cents = plan === 'PRO' ? proCents : enterpriseCents;
      return {
        plan,
        label: PLAN_LABELS[plan],
        monthlyCents: cents,
        share: totalCents === 0 ? 0 : cents / totalCents,
        color: PLAN_COLORS[plan],
      };
    });

  // ---- Storage ------------------------------------------------------------
  // Total ~ 4.2 TiB, quota 16 TiB.
  const totalGiB = 3000 + Math.floor(rand() * 3500); // 3.0..6.5 TiB
  const totalBytes = totalGiB * 1024 * 1024 * 1024;
  const quotaBytes = 16 * 1024 * 1024 * 1024 * 1024;
  const topNames = pickN(TENANT_NAME_POOL, 10, rand);
  // Weighted distribution: a few tenants dominate (long tail).
  const topShares = [0.18, 0.12, 0.09, 0.07, 0.06, 0.05, 0.04, 0.035, 0.03, 0.025];
  const topTenants = topNames.map((name, i) => {
    const plan: AdminPlanSlug =
      i < 2 ? 'ENTERPRISE' : i < 7 ? 'PRO' : (rand() < 0.5 ? 'PRO' : 'FREE');
    return {
      tenantId: `tnt_${(seed + i).toString(36)}`,
      tenantName: name,
      bytes: Math.floor(totalBytes * topShares[i]!),
      plan,
    };
  });

  // ---- API volume ---------------------------------------------------------
  // ~12k/h baseline; gentle hour-of-day curve.
  const hourlySeries24h = Array.from({ length: 24 }, (_, h) => {
    const hourDate = addHours(startOfDay(now), h - 23); // last 24 hours, ending now
    const hourOfDay = hourDate.getUTCHours();
    // Activity peaks at 09:00 and 14:00 UTC.
    const peak = Math.exp(-Math.pow((hourOfDay - 9) / 3, 2)) + Math.exp(-Math.pow((hourOfDay - 14) / 3, 2));
    const base = 8000 + Math.floor(rand() * 4000); // 8k..12k baseline
    return {
      hour: formatISO(hourDate, { representation: 'complete' }),
      count: Math.floor(base + peak * 4500),
    };
  });
  const sum24 = hourlySeries24h.reduce((a, p) => a + p.count, 0);
  // 7d = 24h * 6.2 (slight dip on weekends), 30d = 7d * 4.05.
  const last7d = Math.floor(sum24 * (6 + rand() * 0.6));
  const last30d = Math.floor(last7d * (4 + rand() * 0.15));

  // ---- Tenant growth (last 30 days, daily) -------------------------------
  const days = 30;
  const points: TenantGrowthPoint[] = Array.from({ length: days }, (_, i) => {
    const date = addDays(startOfDay(now), i - (days - 1));
    // Drift active up gently with a small wobble; suspended is flat-ish.
    const trend = active - Math.floor((days - 1 - i) * 0.7);
    const wobble = Math.floor((rand() - 0.5) * 4);
    return {
      date: formatISO(date, { representation: 'date' }),
      active: Math.max(0, trend + wobble),
      suspended: Math.max(0, suspended + Math.floor((rand() - 0.5) * 3)),
    };
  });

  return {
    generatedAt: now.toISOString(),
    window,
    tenants: {
      total,
      active,
      suspended,
      archived,
      netAddsLast7d,
    },
    mrr: {
      totalCents,
      byPlan: {
        FREE: 0,
        PRO: proCents,
        ENTERPRISE: enterpriseCents,
      },
      plansRanked: ranks,
      currency: 'USD',
      period: 'mrr',
    },
    storage: {
      totalBytes,
      quotaBytes,
      topTenants,
    },
    apiVolume: {
      last24h: sum24,
      last7d,
      last30d,
      hourlySeries24h,
    },
    tenantGrowth: {
      days,
      points,
    },
    revenueByPlan,
  };
}

/** Pick `n` unique entries from `arr` using the provided RNG. */
function pickN<T>(arr: readonly T[], n: number, rand: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(rand() * pool.length);
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}
