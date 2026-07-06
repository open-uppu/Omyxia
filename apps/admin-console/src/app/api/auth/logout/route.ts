/**
 * POST /api/auth/logout — clears the cookie and (best-effort) tells the
 * backend to invalidate the token server-side.
 *
 * Always returns 200 — logout must be idempotent. The client-side
 * `logout()` clears the cookie itself; this endpoint exists so the
 * backend gets a chance to write an audit entry.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  const apiUrl = process.env.ADMIN_API_URL;
  if (apiUrl) {
    try {
      await fetch(`${apiUrl.replace(/\/$/, '')}/admin/auth/logout`, {
        method: 'POST',
        cache: 'no-store',
      });
    } catch {
      // Best-effort — never fail logout because the backend is down.
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: 'admin_session',
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: false,
    sameSite: 'strict',
  });
  return res;
}