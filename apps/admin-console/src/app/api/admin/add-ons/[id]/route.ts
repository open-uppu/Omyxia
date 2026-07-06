/**
 * /api/admin/add-ons/[id] — read/update/delete add-on (P2.5).
 *
 *   GET    /api/admin/add-ons/[id]   → AdminAddOn
 *   PATCH  /api/admin/add-ons/[id]   → AdminAddOn  (UpdateAddOnDtoSchema body)
 *   DELETE /api/admin/add-ons/[id]   → 204 / 404
 *
 * Same dev-mode + auth + caching patterns as the plans routes.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  AdminAddOnSchema,
  UpdateAddOnDtoSchema,
} from '@omyxia/shared-types';
import { verifyAdminToken } from '@/lib/jwt';
import {
  buildMockAddOnsList,
  deleteMockAddOn,
  PLANS_MOCK_FIXED_TS,
  updateMockAddOn,
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
    const { addOns } = buildMockAddOnsList(generatedAt());
    const addOn = addOns.find((a) => a.id === id);
    if (!addOn) {
      return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });
    }
    return NextResponse.json(addOn, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/add-ons/${id}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      cache: 'no-store',
    });
    if (upstream.status === 404) {
      return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: 502 }
      );
    }
    const raw = await upstream.json();
    const result = AdminAddOnSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Upstream returned malformed add-on' },
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
  const parsed = UpdateAddOnDtoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid add-on update payload',
        issues: parsed.error.issues.slice(0, 10),
      },
      { status: 400 }
    );
  }

  if (!isProdMode()) {
    const updated = updateMockAddOn(id, parsed.data, generatedAt());
    if (!updated) {
      return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/add-ons/${id}`, {
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
      return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: 502 }
      );
    }
    const raw = await upstream.json();
    const result = AdminAddOnSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Upstream returned malformed add-on' },
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
    const ok = deleteMockAddOn(id);
    if (!ok) {
      return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/add-ons/${id}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      cache: 'no-store',
    });
    if (upstream.status === 404) {
      return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });
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
