/**
 * GET /api/admin/metrics — Dashboard data for the super_admin console.
 *
 * Returns a DashboardMetrics payload per
 * `@omyxia/shared-types/src/admin-metrics`. Two modes:
 *
 *   1. Dev mode (ADMIN_DEV_MODE=true, ADMIN_API_URL unset):
 *      We synthesise a deterministic mock so the dashboard renders
 *      end-to-end with no backend. The mock is **seeded by date +
 *      window** so refreshing within the same day shows the same
 *      numbers — useful for screenshots and visual regression.
 *
 *   2. Production mode (ADMIN_API_URL set):
 *      We proxy to `${ADMIN_API_URL}/admin/metrics`. The backend
 *      (P2.x time-series card) will own producing this payload.
 *      Whatever the backend returns is validated against
 *      `DashboardMetricsSchema` before being forwarded; if the
 *      shape is wrong we surface a 502 to the dashboard so the UI
 *      can render an error card rather than blowing up.
 *
 * Auth:
 *   - The route is gated by the same `admin_session` cookie as the
 *     rest of the (app)/* tree. Re-verifying here gives us a clean
 *     401 boundary if the cookie gets stale and prevents accidental
 *     hits from unrelated cookies.
 *
 * Caching:
 *   - `cache: 'no-store'` (browser + Next fetch) — the dashboard
 *     owns the 5-minute refresh cadence, we don't want any
 *     intermediate cache layer to make that lag.
 *   - `dynamic = 'force-dynamic'` so Next doesn't try to statically
 *     optimise this response at build time (the cookie is read).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/jwt';
import {
  DashboardMetricsSchema,
  AdminAggregationWindowSchema,
  type AdminAggregationWindow,
} from '@omyxia/shared-types';
import { generateMockMetrics } from '@/lib/metrics-mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isDevMode(): boolean {
  return process.env.ADMIN_DEV_MODE === 'true';
}

function parseWindow(req: NextRequest): AdminAggregationWindow {
  const raw = req.nextUrl.searchParams.get('window');
  const result = AdminAggregationWindowSchema.safeParse(raw ?? '24h');
  return result.success ? result.data : '24h';
}

export async function GET(req: NextRequest) {
  // ---- Auth gate --------------------------------------------------------
  const cookieStore = cookies();
  const token = cookieStore.get('admin_session')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const verified = await verifyAdminToken(token);
  if (!verified.ok) {
    return NextResponse.json({ error: 'Invalid session', reason: verified.reason }, { status: 401 });
  }

  const window = parseWindow(req);

  // ---- Dev mode (no upstream) -------------------------------------------
  if (isDevMode() || !process.env.ADMIN_API_URL) {
    const metrics = generateMockMetrics(window);
    return NextResponse.json(metrics, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // ---- Proxy to backend -------------------------------------------------
  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  const upstream = `${apiUrl}/admin/metrics?window=${encodeURIComponent(window)}`;
  try {
    const res = await fetch(upstream, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // Forward the admin JWT so the backend can verify (no need to
        // re-sign — it uses the same secret).
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
      });
    }
    // Defensive parse — never blindly forward shapes the frontend
    // can't render. A bad payload gets a clear 502.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: 'Bad upstream response', detail: 'non-JSON body' },
        { status: 502 }
      );
    }
    const parsed = DashboardMetricsSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Upstream metrics schema mismatch',
          issues: parsed.error.issues.slice(0, 5),
        },
        { status: 502 }
      );
    }
    return NextResponse.json(parsed.data, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Metrics upstream failure', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
