/**
 * GET /api/auth/me — returns the current admin user from the
 * `admin_session` cookie. Returns 401 if the cookie is missing or
 * invalid (server-side verification — never trusts the raw payload).
 *
 * Useful for the client-side `useCurrentAdmin` hook to avoid duplicating
 * JWT-decode logic, and for any future tooling (e.g. an admin CLI).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAdminToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const verified = await verifyAdminToken(token);
  if (!verified.ok) {
    return NextResponse.json({ error: 'Invalid session', reason: verified.reason }, { status: 401 });
  }
  return NextResponse.json({
    id: verified.claims.sub,
    email: verified.claims.email,
    name: verified.claims.name,
    role: verified.claims.role,
  });
}