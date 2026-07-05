// @vitest-environment node
//
// Tests for GET /api/entitlements/me (P3.2).
//
// We stub `next/headers` + `verifyAdminToken` so the route handler can
// run in Node without a real request scope. Same pattern as
// /api/admin/upgrade-impressions/route.test.ts.
//
// Coverage:
//   1. Auth — 401 on missing/invalid cookie.
//   2. Dev mode — returns a validated FREE/PRO/ENTERPRISE payload.
//   3. Dev mode env overrides (ADMIN_DEV_PLAN, ADMIN_DEV_TENANT).
//   4. Prod mode proxy — happy path (parses BE response + validates).
//   5. Prod mode — 401 from upstream propagates as 401.
//   6. Prod mode — 5xx from upstream → 502.
//   7. Prod mode — malformed upstream payload → 502 (sanitised).
//   8. Prod mode — fetch throws → 502.
//   9. The response Cache-Control is set correctly per mode.

import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock next/headers so we can inject the cookie store from the test.
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

// Mock verifyAdminToken so we don't need the real jose runtime here
// (the jwt.test.ts covers that). We control the return value per test.
vi.mock('@/lib/jwt', () => ({
  verifyAdminToken: vi.fn(),
}));

import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/jwt';
import { GET } from './route';

const cookieMock = cookies as unknown as ReturnType<typeof vi.fn>;
const verifyAdminTokenMock = verifyAdminToken as unknown as ReturnType<
  typeof vi.fn
>;

const ORIGINAL_API_URL = process.env.ADMIN_API_URL;
const ORIGINAL_DEV_PLAN = process.env.ADMIN_DEV_PLAN;
const ORIGINAL_DEV_TENANT = process.env.ADMIN_DEV_TENANT;

beforeAll(() => {
  process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-minimum-aaaaaaaaaa';
  process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
  process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
});

afterEach(() => {
  if (ORIGINAL_API_URL === undefined) delete process.env.ADMIN_API_URL;
  else process.env.ADMIN_API_URL = ORIGINAL_API_URL;
  if (ORIGINAL_DEV_PLAN === undefined) delete process.env.ADMIN_DEV_PLAN;
  else process.env.ADMIN_DEV_PLAN = ORIGINAL_DEV_PLAN;
  if (ORIGINAL_DEV_TENANT === undefined) delete process.env.ADMIN_DEV_TENANT;
  else process.env.ADMIN_DEV_TENANT = ORIGINAL_DEV_TENANT;
  vi.restoreAllMocks();
});

type TokenOption = string | null;

function makeReq(token: TokenOption = 'valid-token', verifyResult?: unknown) {
  const inner = vi.fn();
  inner.mockReturnValue(token !== null ? { value: token } : null);
  cookieMock.mockReturnValue({ get: inner });
  // Default verify → ok:true with valid super_admin claims.
  verifyAdminTokenMock.mockReturnValue(
    verifyResult !== undefined
      ? verifyResult
      : {
          ok: true,
          claims: {
            sub: 'u-99',
            email: 'admin@omyxia.app',
            name: 'Bootstrap Admin',
            role: 'super_admin',
          },
        }
  );
  return new NextRequest(
    new Request('http://localhost/api/entitlements/me', { method: 'GET' })
  );
}

describe('GET /api/entitlements/me — auth', () => {
  it('returns 401 when there is no cookie', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
  });

  it('returns 401 when verifyAdminToken rejects', async () => {
    const res = await GET(
      makeReq('any-token', { ok: false, reason: 'expired' })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.reason).toBe('expired');
  });
});

describe('GET /api/entitlements/me — dev mode', () => {
  it('returns the PRO fixture by default', async () => {
    delete process.env.ADMIN_API_URL;
    delete process.env.ADMIN_DEV_PLAN;
    delete process.env.ADMIN_DEV_TENANT;
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.plan).toBe('PRO');
    expect(body.features['admin.tenants']).toBe(true);
    expect(body.features['admin.plans']).toBe(true);
    expect(body.features['admin.audit']).toBe(false);
    expect(body.limits['limit.maxUsers']).toBe(25);
    expect(body.usage?.['limit.maxUsers']).toBe(12);
    expect(typeof body.generatedAt).toBe('string');
    expect(body.tenantId).toBe('t-demo');
  });

  it('honours ADMIN_DEV_PLAN=FREE', async () => {
    delete process.env.ADMIN_API_URL;
    process.env.ADMIN_DEV_PLAN = 'FREE';
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.plan).toBe('FREE');
    expect(body.features['admin.plans']).toBe(false);
    expect(body.features['module.crm']).toBe(false);
    expect(body.features['module.hr']).toBe(false);
    expect(body.limits['limit.maxUsers']).toBe(3);
  });

  it('honours ADMIN_DEV_PLAN=ENTERPRISE (null limits)', async () => {
    delete process.env.ADMIN_API_URL;
    process.env.ADMIN_DEV_PLAN = 'ENTERPRISE';
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.plan).toBe('ENTERPRISE');
    expect(body.limits['limit.maxUsers']).toBeNull();
    expect(body.limits['limit.maxStorageGB']).toBeNull();
    expect(body.features['admin.audit']).toBe(true);
  });

  it('honours ADMIN_DEV_TENANT override', async () => {
    delete process.env.ADMIN_API_URL;
    process.env.ADMIN_DEV_TENANT = 't-enterprise-42';
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.tenantId).toBe('t-enterprise-42');
  });

  it('falls back to PRO when ADMIN_DEV_PLAN is garbage', async () => {
    delete process.env.ADMIN_API_URL;
    process.env.ADMIN_DEV_PLAN = 'ULTRA';
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.plan).toBe('PRO');
  });

  it('always emits a valid EntitlementsSchema payload', async () => {
    delete process.env.ADMIN_API_URL;
    process.env.ADMIN_DEV_PLAN = 'FREE';
    process.env.ADMIN_DEV_TENANT = 't-foo';
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveProperty('tenantId');
    expect(body).toHaveProperty('plan');
    expect(body).toHaveProperty('planLabel');
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('features');
    expect(body).toHaveProperty('limits');
    expect(['FREE', 'PRO', 'ENTERPRISE']).toContain(body.plan);
    expect(typeof body.features).toBe('object');
    expect(typeof body.limits).toBe('object');
  });
});

describe('GET /api/entitlements/me — prod proxy', () => {
  it('forwards to ADMIN_API_URL and validates the response', async () => {
    process.env.ADMIN_API_URL = 'http://api.example.test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tenantId: 't-remote',
          plan: 'PRO',
          planLabel: 'Pro',
          generatedAt: '2026-07-05T00:00:00.000Z',
          features: { 'admin.tenants': true, 'module.crm': true },
          limits: { 'limit.maxUsers': 25 },
          usage: { 'limit.maxUsers': 5 },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=60',
          },
        }
      )
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('http://api.example.test/entitlements/me');
    expect(calledInit.method).toBe('GET');
    expect(
      (calledInit.headers as Record<string, string>).Authorization
    ).toMatch(/^Bearer /);
    expect(res.headers.get('Cache-Control')).toBe('max-age=60');
    const body = await res.json();
    expect(body.tenantId).toBe('t-remote');
    expect(body.plan).toBe('PRO');
  });

  it('propagates upstream 401 as 401', async () => {
    process.env.ADMIN_API_URL = 'http://api.example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'expired' }), { status: 401 })
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/session/i);
  });

  it('returns 502 on upstream 5xx', async () => {
    process.env.ADMIN_API_URL = 'http://api.example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 503 })
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/upstream/i);
    expect(body.status).toBe(503);
  });

  it('returns 502 (sanitised) on malformed upstream payload', async () => {
    process.env.ADMIN_API_URL = 'http://api.example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          // Missing required fields: plan, features, limits.
          tenantId: 't-bad',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/malformed/i);
    // The malformed body must NOT be echoed — we only emit a sanitised
    // error string. The internal `tenantId` from the upstream payload
    // MUST NOT appear in our response.
    expect(JSON.stringify(body)).not.toContain('t-bad');
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns 502 when fetch throws (network failure)', async () => {
    process.env.ADMIN_API_URL = 'http://api.example.test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/upstream/i);
    expect(body.detail).toContain('ECONNREFUSED');
  });
});