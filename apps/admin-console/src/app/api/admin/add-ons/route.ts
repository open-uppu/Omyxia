/**
 * /api/admin/add-ons — list + create add-ons (P2.5).
 *
 *   GET  → ListAddOnsResponse
 *   POST → AdminAddOn (CreateAddOnDtoSchema body)
 *
 * Mirrors the `/api/admin/plans` collection route. Same dev-mode
 * fallback; same auth gate.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  CreateAddOnDtoSchema,
  ListAddOnsResponseSchema,
  type AdminAddOn,
} from '@omyxia/shared-types';
import { verifyAdminToken } from '@/lib/jwt';
import {
  buildMockAddOnsList,
  createMockAddOn,
  PLANS_MOCK_FIXED_TS,
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

export async function GET(_req: NextRequest) {
  const authFailure = await verifySession();
  if (authFailure) return authFailure;

  if (!isProdMode()) {
    const payload = buildMockAddOnsList(generatedAt());
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/add-ons`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: 502 }
      );
    }
    const raw = await upstream.json();
    const result = ListAddOnsResponseSchema.safeParse(raw);
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.error(
        '[add-ons GET] upstream payload failed schema validation',
        result.error.issues.slice(0, 5)
      );
      return NextResponse.json(
        { error: 'Upstream returned malformed add-ons' },
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

export async function POST(req: NextRequest) {
  const authFailure = await verifySession();
  if (authFailure) return authFailure;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  const parsed = CreateAddOnDtoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid add-on payload',
        issues: parsed.error.issues.slice(0, 10),
      },
      { status: 400 }
    );
  }

  if (!isProdMode()) {
    const created: AdminAddOn = createMockAddOn(parsed.data, generatedAt());
    return NextResponse.json(created, { status: 201 });
  }

  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/add-ons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFromCookie()}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream failure', status: upstream.status },
        { status: upstream.status === 401 ? 401 : 502 }
      );
    }
    const raw = await upstream.json();
    const { AdminAddOnSchema } = await import('@omyxia/shared-types');
    const result = AdminAddOnSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Upstream returned malformed add-on' },
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
