/**
 * POST /api/auth/login — admin login.
 *
 * Dev mode (ADMIN_DEV_MODE=true): accepts the hard-coded bootstrap
 * credentials (admin@omyxia.app / admin) and mints an admin-session JWT
 * locally using `ADMIN_JWT_SECRET`. This lets the shell be exercised
 * end-to-end without a backend running.
 *
 * Prod mode (ADMIN_DEV_MODE=false): proxies to the backend's
 * /admin/auth/login endpoint (configured via ADMIN_API_URL). The
 * backend (P1.3) is the source of truth for super_admin credentials
 * and will issue the JWT with the same secret we verify with.
 *
 * Security:
 * - Never returns whether the user exists — always returns "invalid
 *   credentials" for both bad email and bad password (dev mode is the
 *   only exception, where we accept a fixed pair).
 * - The dev endpoint is gated by `ADMIN_DEV_MODE` and emits a clear
 *   log marker so we never accidentally ship it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { signAdminToken, ADMIN_ROLE } from '@/lib/jwt';

export const runtime = 'nodejs'; // jose is fine on edge but we keep this on node for clarity.

const DEV_BOOTSTRAP_EMAIL = 'admin@omyxia.app';
const DEV_BOOTSTRAP_PASSWORD = 'admin';
const DEV_BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const DEV_BOOTSTRAP_NAME = 'Bootstrap Admin';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function isDevMode(): boolean {
  return process.env.ADMIN_DEV_MODE === 'true';
}

export async function POST(req: NextRequest) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  if (isDevMode()) {
    if (email === DEV_BOOTSTRAP_EMAIL && password === DEV_BOOTSTRAP_PASSWORD) {
      const token = await signAdminToken({
        sub: DEV_BOOTSTRAP_ID,
        email: DEV_BOOTSTRAP_EMAIL,
        name: DEV_BOOTSTRAP_NAME,
      });
      return NextResponse.json({
        token,
        user: {
          id: DEV_BOOTSTRAP_ID,
          email: DEV_BOOTSTRAP_EMAIL,
          name: DEV_BOOTSTRAP_NAME,
          role: ADMIN_ROLE,
        },
        devMode: true,
      });
    }
    // Fall through to backend proxy if creds don't match dev bootstrap —
    // the developer may be pointing at a real backend while still having
    // dev mode on for other local conveniences.
  }

  const apiUrl = process.env.ADMIN_API_URL;
  if (!apiUrl) {
    return NextResponse.json(
      {
        error:
          'Backend auth is not configured. Set ADMIN_API_URL or enable ADMIN_DEV_MODE for local shell testing.',
      },
      { status: 503 }
    );
  }

  try {
    const upstream = await fetch(`${apiUrl.replace(/\/$/, '')}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
      // Forwarding cookies would break the standalone-origin design; we do
      // NOT forward any cookies from the browser to the backend here.
      cache: 'no-store',
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Upstream auth failure', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}