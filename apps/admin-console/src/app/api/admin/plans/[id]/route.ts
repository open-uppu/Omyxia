/**
 * /api/admin/plans/[id] — single-plan read/update/delete (P2.5).
 *
 *   GET    /api/admin/plans/[id]   → AdminPlan
 *   PATCH  /api/admin/plans/[id]   → AdminPlan   (UpdatePlanDtoSchema body)
 *   DELETE /api/admin/plans/[id]   → 204 on success, 404 on miss
 *
 * Drag-drop reorder lives on a sibling subroute at
 * `/api/admin/plans/[id]/features/reorder/route.ts` so this file
 * stays focused on CRUD.
 *
 * Two modes (same as the collection route):
 *   - Dev mode (no `ADMIN_API_URL`): in-memory `plans-mock` store.
 *   - Prod mode: proxy to `${ADMIN_API_URL}/admin/plans/[id]`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  AdminPlanSchema,
  UpdatePlanDtoSchema,
} from '@omyxia/shared-types';
import { verifyAdminToken } from '@/lib/jwt';
import {
  buildMockPlansList,
  deleteMockPlan,
  PLANS_MOCK_FIXED_TS,
  updateMockPlan,
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

export async function GET(_req: NextRequest, ctx: RouteParams) {
  const authFailure = await verifySession();
  if (authFailure) return authFailure;
  const id = ctx.params.id;

  if (!isProdMode()) {
    const { plans } = buildMockPlansList(generatedAt());
    const plan = plans.find((p) => p.id === id);
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return NextResponse.json(plan, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/plans/${id}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      cache: 'no-store',
    });
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
      // eslint-disable-next-line no-console
      console.error(
        '[plans/:id GET] upstream payload failed schema validation',
        result.error.issues.slice(0, 5)
      );
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

export async function PATCH(req: NextRequest, ctx: RouteParams) {
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
  const parsed = UpdatePlanDtoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid plan update payload',
        issues: parsed.error.issues.slice(0, 10),
      },
      { status: 400 }
    );
  }

  if (!isProdMode()) {
    const updated = updateMockPlan(id, parsed.data, generatedAt());
    if (!updated) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/plans/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
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

export async function DELETE(_req: NextRequest, ctx: RouteParams) {
  const authFailure = await verifySession();
  if (authFailure) return authFailure;
  const id = ctx.params.id;

  if (!isProdMode()) {
    const ok = deleteMockPlan(id);
    if (!ok) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/plans/${id}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      cache: 'no-store',
    });
    if (upstream.status === 404) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: 502 }
      );
    }
    return new NextResponse(null, { status: 204 });
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
