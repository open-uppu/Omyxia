/**
 * /api/admin/plans/[id]/features/reorder — drag-drop reordering (P2.5).
 *
 * The editor flips the order of the toggle grid and POSTs the new
 * ordered feature-key list; this endpoint rewrites the sortOrder
 * fields on the BE (or the dev-mode mock).
 *
 * Request:  POST { orderedFeatureKeys: string[] }
 * Response: AdminPlan (the canonical row with the new sortOrder values).
 *
 * Failure modes:
 *   - Missing cookie → 401.
 *   - Plan not found → 404.
 *   - Body missing / wrong shape → 400.
 *   - Upstream 5xx → 502.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  AdminPlanSchema,
  ReorderPlanFeaturesDtoSchema,
} from '@omyxia/shared-types';
import { verifyAdminToken } from '@/lib/jwt';
import {
  PLANS_MOCK_FIXED_TS,
  reorderMockPlanFeatures,
} from '@/lib/plans-mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isProdMode(): boolean {
  return Boolean(process.env.ADMIN_API_URL);
}

function generatedAt(): string {
  return isProdMode() ? new Date().toISOString() : PLANS_MOCK_FIXED_TS;
}

function tokenFromCookie(): string {
  return cookies().get('admin_session')?.value ?? '';
}

async function verifySession(): Promise<NextResponse | null> {
  const token = tokenFromCookie();
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
  return null;
}

interface RouteParams {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteParams) {
  const authFailure = await verifySession();
  if (authFailure) return authFailure;
  const id = ctx.params.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  const parsed = ReorderPlanFeaturesDtoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid reorder payload',
        issues: parsed.error.issues.slice(0, 10),
      },
      { status: 400 }
    );
  }

  if (!isProdMode()) {
    const updated = reorderMockPlanFeatures(
      id,
      parsed.data.orderedFeatureKeys,
      generatedAt()
    );
    if (!updated) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(
      `${apiUrl}/admin/plans/${id}/features/reorder`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${tokenFromCookie()}`,
        },
        body: JSON.stringify(parsed.data),
        cache: 'no-store',
      }
    );
    if (upstream.status === 404) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: 502 }
      );
    }
    const raw = await upstream.json();
    const result = AdminPlanSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Upstream returned malformed plan' },
        { status: 502 }
      );
    }
    return NextResponse.json(result.data);
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
