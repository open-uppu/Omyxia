/**
 * DEV-ONLY route — sets the admin_session cookie from a `?token=`
 * query parameter and redirects to `?next=`.
 *
 * Used by the visual-smoke capture script. NOT exposed in production
 * builds — guarded by `ADMIN_DEV_MODE` and the lack of an upstream
 * backend. When the real backend (P1.3) lands, this route can stay
 * because the cookie it sets is the same one the real backend will
 * use, but it MUST be disabled (env gate) before production deploy.
 */

import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (process.env.ADMIN_DEV_MODE !== 'true') {
    return NextResponse.json({ error: 'Disabled' }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get('token');
  const next = req.nextUrl.searchParams.get('next') || '/dashboard';

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const url = req.nextUrl.clone();
  url.pathname = next;
  url.search = '';

  const res = NextResponse.redirect(url);
  const secure = req.nextUrl.protocol === 'https:' ? '; Secure' : '';
  res.headers.append(
    'Set-Cookie',
    `admin_session=${encodeURIComponent(token)}; Path=/; Max-Age=28800; SameSite=Strict${secure}`
  );
  return res;
}