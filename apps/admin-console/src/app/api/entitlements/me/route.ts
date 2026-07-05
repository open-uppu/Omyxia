/**
 * GET /api/entitlements/me — current tenant's entitlements (P3.2).
 *
 * Returns a payload validated against `EntitlementsSchema` from
 * `@omyxia/shared-types`. Used by the FE EntitlementsProvider to
 * gate the sidebar nav and to render the /upgrade page.
 *
 * Wire format:
 *   {
 *     tenantId:     string | null,
 *     plan:         'FREE' | 'PRO' | 'ENTERPRISE',
 *     planLabel:    string,
 *     generatedAt:  ISO timestamp,
 *     features:     Record<FeatureKey, boolean>,
 *     limits:       Record<LimitFeatureKey, number | null>,  // null = unlimited
 *     usage?:       Record<LimitFeatureKey, number>,
 *   }
 *
 * Two modes:
 *
 *   1. Dev mode (no `ADMIN_API_URL` set, OR `ADMIN_DEV_MODE=true`):
 *      We return the deterministic fixture from `entitlements-mock.ts`.
 *      No DB, no upstream. The fixture can be flipped via env
 *      (`ADMIN_DEV_PLAN`, `ADMIN_DEV_TENANT`).
 *
 *   2. Prod mode (`ADMIN_API_URL` set): We forward to
 *      `${ADMIN_API_URL}/entitlements/me`. The BE owns the matrix
 *      (P3.1 + P1.x time-series expansion). We re-emit the upstream
 *      body byte-for-byte after a schema re-check — that way a bad
 *      payload from the BE doesn't leak past this boundary.
 *
 * Auth:
 *   - Re-verifies the `admin_session` cookie (defence in depth — same
 *     pattern as `/api/admin/upgrade-impressions`).
 *
 * Caching:
 *   - Dev mode: no-cache (always fresh so the env override is picked up
 *     on the next request).
 *   - Prod mode: respects the upstream `Cache-Control` (we don't
 *     override it). The BE is expected to set a short max-age (60s)
 *     so plan changes propagate without a deploy.
 *
 * Failure modes:
 *   - Missing / invalid cookie → 401.
 *   - Dev mode: never fails (the fixture is fixed).
 *   - Prod upstream 5xx → 502.
 *   - Prod upstream 401 → 401 (session expired at the BE — propagate).
 *   - Prod upstream returns a payload that fails the schema → 502
 *     with a sanitised error (never echo the BE's raw body, it may
 *     contain internal fields).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { EntitlementsSchema } from '@omyxia/shared-types';
import { verifyAdminToken } from '@/lib/jwt';
import {
  buildMockEntitlements,
  readDevPlanOverride,
  readDevTenantOverride,
} from '@/lib/entitlements-mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `generatedAt` is stamped once per process so successive dev-mode
// fetches within the same Node worker see a stable timestamp. Tests
// that need determinism can override via `process.env` per-request
// through the route module — but for the runtime path this is fine.
let cachedGeneratedAt: string | null = null;
function getGeneratedAt(): string {
  if (cachedGeneratedAt) return cachedGeneratedAt;
  cachedGeneratedAt = new Date().toISOString();
  return cachedGeneratedAt;
}

function isProdMode(): boolean {
  return Boolean(process.env.ADMIN_API_URL);
}

export async function GET(_req: NextRequest) {
  // ---- Auth gate --------------------------------------------------------
  const cookieStore = cookies();
  const token = cookieStore.get('admin_session')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const verified = await verifyAdminToken(token);
  if (!verified.ok) {
    return NextResponse.json(
      { error: 'Invalid session', reason: verified.reason },
      { status: 401 }
    );
  }

  // ---- Dev mode (no upstream) -------------------------------------------
  if (!isProdMode()) {
    const payload = buildMockEntitlements({
      tenantId: readDevTenantOverride(),
      plan: readDevPlanOverride(),
      generatedAt: getGeneratedAt(),
    });
    // Round-trip through the schema so we never return a fixture that
    // drifted out of sync with the wire format.
    const parsed = EntitlementsSchema.parse(payload);
    return NextResponse.json(parsed, {
      headers: {
        // Dev: no cache so the env override is picked up next call.
        'Cache-Control': 'no-store',
      },
    });
  }

  // ---- Prod mode: proxy to the BE ---------------------------------------
  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/entitlements/me`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (upstream.status === 401) {
      // Session expired at the BE — propagate so the FE can bounce
      // to /login.
      return NextResponse.json(
        { error: 'Upstream session expired' },
        { status: 401 }
      );
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: 502 }
      );
    }

    const raw = await upstream.json();
    const result = EntitlementsSchema.safeParse(raw);
    if (!result.success) {
      // BE returned something we can't validate — log on the server
      // and return a sanitised 502. We don't echo the raw body because
      // it may contain internal fields the FE doesn't expect.
      // eslint-disable-next-line no-console
      console.error(
        '[entitlements/me] upstream payload failed schema validation',
        result.error.issues.slice(0, 5)
      );
      return NextResponse.json(
        { error: 'Upstream returned malformed entitlements' },
        { status: 502 }
      );
    }

    return NextResponse.json(result.data, {
      headers: {
        // Forward the upstream Cache-Control verbatim so we don't
        // accidentally cache something the BE wanted short-lived.
        'Cache-Control': upstream.headers.get('Cache-Control') ?? 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Upstream failure',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}