/**
 * JWT issuance + verification for admin sessions.
 *
 * The admin console is a standalone SPA (admin.omyxia.app) that runs on a
 * separate origin from the tenant app (app.omyxia.app). It MUST NOT share
 * cookies with the tenant app — a tenant user is never authorised to
 * reach /admin/*.
 *
 * Token shape (HS256, signed by `ADMIN_JWT_SECRET`):
 *   {
 *     sub:        string  — admin user id (uuid)
 *     email:      string
 *     name:       string
 *     role:       'super_admin'   (single role for now)
 *     iss:        'omyxia-admin'
 *     aud:        'admin.omyxia.app'
 *     iat:        number
 *     exp:        number
 *   }
 *
 * The token is delivered to the client as a NON-HttpOnly cookie
 * (`admin_session`) so the React layer can read `sub` for the user menu
 * without an extra round-trip. The HttpOnly version is intentionally NOT
 * used — there are no privileged mutations triggered directly from the
 * browser that bypass the backend (every admin mutation goes through
 * /api/admin/* which re-verifies the JWT on the server).
 *
 * Why jose? — runs in both Edge runtime (middleware) and Node. We use
 * HS256 because the secret is shared between the issuer (BE in prod, FE
 * in dev) and the verifier (FE middleware + any future BE verifier).
 */

import { jwtVerify, SignJWT } from 'jose';

export const ADMIN_ROLE = 'super_admin' as const;
export type AdminRole = typeof ADMIN_ROLE;

export interface AdminClaims {
  sub: string;
  email: string;
  name: string;
  role: AdminRole;
  iat?: number;
  exp?: number;
}

const ALG = 'HS256';

function getSecret(): Uint8Array {
  const raw =
    process.env.ADMIN_JWT_SECRET ||
    'dev-only-secret-change-me-please-32bytes-min';
  // jose requires the secret to be encoded — utf-8 is fine for HS256.
  return new TextEncoder().encode(raw);
}

function getIssuer(): string {
  return process.env.ADMIN_JWT_ISSUER || 'omyxia-admin';
}

function getAudience(): string {
  return process.env.ADMIN_JWT_AUDIENCE || 'admin.omyxia.app';
}

/** Mint an admin-session JWT (HS256). Used by /login (dev) and tests. */
export async function signAdminToken(
  input: { sub: string; email: string; name: string },
  opts: { ttlSeconds?: number } = {}
): Promise<string> {
  const ttl = opts.ttlSeconds ?? 60 * 60 * 8; // 8h default
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    email: input.email,
    name: input.name,
    role: ADMIN_ROLE,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setIssuer(getIssuer())
    .setAudience(getAudience())
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(getSecret());
}

export interface VerifyOk {
  ok: true;
  claims: AdminClaims;
}
export interface VerifyErr {
  ok: false;
  reason: 'expired' | 'invalid' | 'wrong_audience' | 'wrong_issuer' | 'wrong_role' | 'malformed';
}
export type VerifyResult = VerifyOk | VerifyErr;

/**
 * Verify a token and return rich errors so the middleware can build the
 * right response (401 for invalid, 403 for wrong role).
 *
 * This function is safe to call from the Edge runtime (used in
 * `middleware.ts`) — `jose` works without Node-only APIs.
 */
export async function verifyAdminToken(token: string): Promise<VerifyResult> {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: getIssuer(),
      audience: getAudience(),
      algorithms: [ALG],
    });

    if (payload.role !== ADMIN_ROLE) {
      return { ok: false, reason: 'wrong_role' };
    }
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      return { ok: false, reason: 'malformed' };
    }

    return {
      ok: true,
      claims: {
        sub: payload.sub,
        email: payload.email,
        name: (payload.name as string) || payload.email,
        role: ADMIN_ROLE,
        iat: payload.iat,
        exp: payload.exp,
      },
    };
  } catch (err: unknown) {
    const code = (err as { code?: string; name?: string }).code || (err as { name?: string }).name;
    if (code === 'ERR_JWT_EXPIRED') return { ok: false, reason: 'expired' };
    if (code === 'ERR_JWS_INVALID' || code === 'JWTInvalid') return { ok: false, reason: 'invalid' };
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      // jose throws this for audience/issuer mismatch but doesn't distinguish
      // the two — fall back to a generic invalid result; the caller treats
      // it as a redirect to /login anyway.
      return { ok: false, reason: 'invalid' };
    }
    return { ok: false, reason: 'invalid' };
  }
}