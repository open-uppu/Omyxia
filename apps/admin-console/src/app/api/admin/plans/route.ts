/**
 * /api/admin/plans — list + create plans (P2.5).
 *
 * GET  → ListPlansResponse
 * POST → AdminPlan (CreatePlanDtoSchema body)
 *
 * Two modes:
 *
 *   1. Dev mode (no `ADMIN_API_URL`): respond from the in-memory
 *      `plans-mock` store. Mutations stick for the lifetime of the
 *      Node worker.
 *
 *   2. Prod mode (`ADMIN_API_URL` set): proxy to
 *      `${ADMIN_API_URL}/admin/plans`. The BE owns the canonical
 *      matrix; the FE just re-emits with a schema validation pass.
 *
 * Auth:
 *   Re-verifies the `admin_session` cookie (defence in depth — same
 *   pattern as `/api/entitlements/me`).
 *
 * Caching:
 *   Dev mode: `no-store` so env-driven mutations are picked up.
 *   Prod mode: forwards the upstream Cache-Control verbatim.
 *
 * Failure modes:
 *   - Missing/invalid cookie → 401.
 *   - Dev mode: never fails (the store is in-memory + atomic).
 *   - Prod upstream 5xx → 502.
 *   - Prod upstream 401 → 401.
 *   - Prod upstream returns a payload that fails the schema → 502.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  CreatePlanDtoSchema,
  ListPlansResponseSchema,
  type AdminPlan,
  type ListPlansResponse,
} from '@omyxia/shared-types';
import { verifyAdminToken } from '@/lib/jwt';
import {
  buildMockPlansList,
  createMockPlan,
  PLANS_MOCK_FIXED_TS,
} from '@/lib/plans-mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isProdMode(): boolean {
  return Boolean(process.env.ADMIN_API_URL);
}

function generatedAt(): string {
  // Use the mock fixture's fixed TS in dev mode so tests stay stable;
  // fall back to wall-clock in prod (each request gets a fresh TS).
  return isProdMode() ? new Date().toISOString() : PLANS_MOCK_FIXED_TS;
}

export async function GET(_req: NextRequest) {
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

  if (!isProdMode()) {
    const payload = buildMockPlansList(generatedAt());
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/plans`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    if (upstream.status === 401) {
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
    const result = ListPlansResponseSchema.safeParse(raw);
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.error(
        '[plans GET] upstream payload failed schema validation',
        result.error.issues.slice(0, 5)
      );
      return NextResponse.json(
        { error: 'Upstream returned malformed plans' },
        { status: 502 }
      );
    }
    return NextResponse.json(result.data, {
      headers: {
        'Cache-Control':
          upstream.headers.get('Cache-Control') ?? 'no-store',
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

export async function POST(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  const parsed = CreatePlanDtoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid plan payload',
        issues: parsed.error.issues.slice(0, 10),
      },
      { status: 400 }
    );
  }

  if (!isProdMode()) {
    const created: AdminPlan = createMockPlan(parsed.data, generatedAt());
    return NextResponse.json(created, { status: 201 });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      const detail = await upstream.text();
      return NextResponse.json(
        {
          error: 'Upstream failure',
          status: upstream.status,
          detail: detail.slice(0, 500),
        },
        { status: upstream.status === 401 ? 401 : 502 }
      );
    }
    const raw = await upstream.json();
    // Single-row payload validates against AdminPlanSchema.
    const result = await (await import('@omyxia/shared-types'))
      .AdminPlanSchema.safeParseAsync(raw)
      .catch(() => ({ success: false as const }));
    if (!result || !result.success) {
      return NextResponse.json(
        { error: 'Upstream returned malformed plan' },
        { status: 502 }
      );
    }
    return NextResponse.json(result.data, { status: 201 });
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

// Re-export for tests that need the type of an empty list response.
export type ListPlansResponseForTests = ListPlansResponse;
