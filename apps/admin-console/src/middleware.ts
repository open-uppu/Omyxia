/**
 * Auth gate for /admin/*.
 *
 * Runs on every request to the admin console. Verifies the
 * `admin_session` cookie using `verifyAdminToken` (jose, Edge-compatible).
 *
 * Behavior matrix:
 *
 *   Path                          | Cookie ok & super_admin | No/expired cookie | Wrong role
 *   ------------------------------|--------------------------|--------------------|-----------
 *   /login, /api/auth/*, _next/*  | pass-through             | pass-through       | pass-through
 *   /                             | redirect -> /dashboard   | redirect -> /login | redirect -> /login
 *   /<anything>                   | pass-through             | redirect -> /login | redirect -> /login
 *
 * Rationale:
 * - /login must be reachable when unauthenticated.
 * - /api/auth/* is the login flow itself (cannot be gated by its own cookie).
 * - /_next/* + /favicon* are framework assets and never need a JWT.
 * - The root path / redirects to either /dashboard (authed) or /login.
 *
 * Security:
 * - Token verification uses HS256 with `ADMIN_JWT_SECRET`. The same
 *   secret is used by the dev login endpoint and, in production, by the
 *   backend that issues real super_admin tokens (P1.3).
 * - We do NOT log or echo the token anywhere — only its presence/expiry.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAdminToken } from '@/lib/jwt';

const PUBLIC_PATH_PREFIXES = ['/login', '/api/auth', '/_next', '/favicon'];
const ROOT_PATH = '/';

function isPublicPath(pathname: string): boolean {
  if (pathname === ROOT_PATH) return false; // / is handled by root-redirect logic
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Static + framework assets never need a JWT.
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('admin_session')?.value;
  const verified = token ? await verifyAdminToken(token) : null;

  // ---- Public paths ---------------------------------------------------------
  if (isPublicPath(pathname)) {
    // If a verified user hits /login, bounce them to /dashboard.
    if (pathname === '/login' && verified?.ok) {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ---- Root path ------------------------------------------------------------
  if (pathname === ROOT_PATH) {
    const url = req.nextUrl.clone();
    url.pathname = verified?.ok ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  // ---- Protected paths ------------------------------------------------------
  if (!verified?.ok) {
    // Preserve the originally requested URL so we can bounce back after login.
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname + req.nextUrl.search);
    if (verified && !verified.ok && verified.reason === 'wrong_role') {
      url.searchParams.set('reason', 'forbidden');
    }
    return NextResponse.redirect(url);
  }

  // Verified super_admin — pass through with a couple of response headers
  // that the server components may read (e.g. for audit logging).
  const res = NextResponse.next();
  res.headers.set('x-admin-id', verified.claims.sub);
  res.headers.set('x-admin-role', verified.claims.role);
  return res;
}

export const config = {
  matcher: [
    // Run on everything except static assets and the dev / public ones that
    // Next.js itself emits. We intentionally do NOT exclude /api/auth/*
    // because we want to inspect the cookie there too — but isPublicPath
    // lets those requests through unchanged.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};