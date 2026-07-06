/**
 * POST /api/admin/upgrade-impressions — receive upgrade-modal
 * impression events from the admin console (P3.4).
 *
 * Wire format (validated with zod from @omyxia/shared-types):
 *
 *   {
 *     events: [
 *       {
 *         kind: 'shown' | 'dismissed' | 'cta_clicked' | 'plan_viewed',
 *         feature: string,
 *         shownAt: ISO string,
 *         at: ISO string,
 *         currentPlan: 'FREE' | 'PRO' | 'ENTERPRISE',
 *         recommendedPlan: 'FREE' | 'PRO' | 'ENTERPRISE',
 *         ctaTarget?: 'mailto' | 'in_app_upgrade'
 *       },
 *       ...
 *     ]
 *   }
 *
 * Two modes:
 *
 *   1. Dev mode (no ADMIN_API_URL): we accept the batch and emit a
 *      `console.info` so the dev can see what was tracked. We never
 *      persist — there is no DB.
 *
 *   2. Prod mode (ADMIN_API_URL set): we forward the batch to
 *      `${ADMIN_API_URL}/admin/upgrade-impressions`. The BE will own
 *      persistence (P1.x time-series store — same one the audit log
 *      uses, per P5.2 WORM storage).
 *
 * Auth:
 *   - Re-verifies the `admin_session` cookie so the route is its own
 *     auth boundary (defence in depth — the modal could theoretically
 *     be triggered by any page; we don't trust the caller's auth).
 *
 * Failure modes:
 *   - Missing / invalid body → 400.
 *   - Unauthenticated → 401.
 *   - Upstream proxy fails → 502.
 *   - Upstream returns 5xx → 502 (don't lose events silently).
 *   - Upstream returns 2xx → 204 (no body — we don't need to ack).
 *
 * The `keepalive: true` fetch option on the FE side means we may
 * receive requests mid-navigation; we keep the route handler cheap
 * (no DB I/O in dev mode, no parsing of individual events beyond
 * the schema check) so the server can answer in <5ms.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { verifyAdminToken } from '@/lib/jwt';
import { UpgradeImpressionSchema } from '@omyxia/shared-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  events: z.array(UpgradeImpressionSchema).max(100),
});

function isDevMode(): boolean {
  return process.env.ADMIN_DEV_MODE === 'true' || !process.env.ADMIN_API_URL;
}

export async function POST(req: NextRequest) {
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

  // ---- Parse + validate -------------------------------------------------
  let parsedBody: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const result = BodySchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid body', issues: result.error.issues.slice(0, 5) },
        { status: 400 }
      );
    }
    parsedBody = result.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ---- Dev mode (no upstream) -------------------------------------------
  if (isDevMode()) {
    if (parsedBody.events.length > 0) {
      // eslint-disable-next-line no-console
      console.info(
        `[upgrade-impressions] dev-mode received ${parsedBody.events.length} event(s):`,
        parsedBody.events.map((e) => `${e.kind}/${e.feature}`).join(', ')
      );
    }
    return new NextResponse(null, { status: 204 });
  }

  // ---- Proxy to backend -------------------------------------------------
  const apiUrl = process.env.ADMIN_API_URL!.replace(/\/$/, '');
  try {
    const upstream = await fetch(`${apiUrl}/admin/upgrade-impressions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(parsedBody),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return new NextResponse(
        JSON.stringify({ error: 'Upstream rejected impression batch', status: upstream.status }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Upstream failure', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}