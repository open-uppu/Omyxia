/**
 * Client-side admin session helpers.
 *
 * - Reads/writes the `admin_session` cookie from `document.cookie`. The
 *   cookie is NOT HttpOnly because the React layer needs to render the
 *   user's name/email in the topbar without an extra round-trip. The
 *   middleware (Edge) does the actual verification on every navigation.
 *
 * - `logout()` clears the cookie and routes back to /login.
 *
 * - In dev mode (ADMIN_DEV_MODE=true) `loginWithCredentials` calls the
 *   dev /api/dev/login endpoint which mints a token locally. In prod
 *   the dev endpoint is disabled and the form posts to the real backend.
 */

import type { AdminClaims } from './jwt';

export const ADMIN_COOKIE = 'admin_session';
export const ADMIN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h — matches JWT TTL

export function readAdminCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${ADMIN_COOKIE}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = decodeURIComponent(trimmed.slice(prefix.length));
    // Treat `admin_session=` (empty) as "not set" — this matches the
    // behaviour of `clearAdminCookie()` setting Max-Age=0. jsdom keeps
    // the key in `document.cookie` even after Max-Age=0; without this
    // guard the menu would think it was logged in after sign-out.
    if (value === '') return null;
    return value;
  }
  return null;
}

export function writeAdminCookie(token: string): void {
  if (typeof document === 'undefined') return;
  // SameSite=Strict because we never need cross-site admin requests.
  // Secure is added automatically in production builds (NEXT_PUBLIC_VERCEL
  // is not used here — we just gate on https://).
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? '; Secure'
    : '';
  document.cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}; SameSite=Strict${secure}`;
}

export function clearAdminCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ADMIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
}

/** Decode the JWT payload WITHOUT verification. Use only for display. */
export function decodeClaims(token: string): AdminClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1]!;
    // base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const json = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (parsed.role !== 'super_admin' || typeof parsed.sub !== 'string') return null;
    return {
      sub: parsed.sub,
      email: parsed.email,
      name: parsed.name || parsed.email,
      role: 'super_admin',
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function getCurrentClaims(): AdminClaims | null {
  const token = readAdminCookie();
  if (!token) return null;
  const claims = decodeClaims(token);
  if (!claims) return null;
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

/**
 * Posts credentials to the dev or production login endpoint.
 * On success, persists the returned token to the cookie.
 */
export async function loginWithCredentials(
  email: string,
  password: string
): Promise<LoginResult> {
  const endpoint = '/api/auth/login';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body && (body.error || body.message)) || `Login failed (${res.status})`;
      return { ok: false, error: String(msg) };
    }
    const data = (await res.json()) as { token: string };
    if (!data.token) return { ok: false, error: 'Login response missing token' };
    writeAdminCookie(data.token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export function logout(): void {
  clearAdminCookie();
  if (typeof window !== 'undefined') {
    // Hit the dev logout endpoint (no-op in prod) so we have a server-side
    // trail of the action for the audit log even before the backend is
    // wired up. Failure is non-fatal — the cookie is already cleared.
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(
      () => undefined
    );
    window.location.href = '/login';
  }
}