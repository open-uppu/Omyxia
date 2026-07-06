// @vitest-environment node
// Reason: jose's internal `payload instanceof Uint8Array` check fails
// under jsdom (separate Uint8Array realm). The route mints/verifies
// JWTs, so it must run under the Node env. Same reason as
// src/lib/jwt.test.ts.

/**
 * Tests for GET /api/admin/metrics.
 *
 *  - 401 when no admin_session cookie.
 *  - 401 when the cookie is present but fails JWT verification.
 *  - 200 dev-mode mock when ADMIN_DEV_MODE=true (no ADMIN_API_URL).
 *  - 200 proxied payload (shape-validated) when ADMIN_API_URL set.
 *  - 502 when the upstream returns a shape that fails
 *    DashboardMetricsSchema (defence in depth against backend drift).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { signAdminToken } from '@/lib/jwt';

// We mock next/headers so we can inject the cookie store from the test.
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

const cookieMock = cookies as unknown as ReturnType<typeof vi.fn>;

function makeReq(url = 'http://localhost:3001/api/admin/metrics?window=24h') {
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/admin/metrics', () => {
  const originalDevMode = process.env.ADMIN_DEV_MODE;
  const originalApiUrl = process.env.ADMIN_API_URL;

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
  });

  afterEach(() => {
    if (originalDevMode === undefined) delete process.env.ADMIN_DEV_MODE;
    else process.env.ADMIN_DEV_MODE = originalDevMode;
    if (originalApiUrl === undefined) delete process.env.ADMIN_API_URL;
    else process.env.ADMIN_API_URL = originalApiUrl;
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('rejects requests without an admin_session cookie', async () => {
    process.env.ADMIN_DEV_MODE = 'true';
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('rejects requests with a malformed token', async () => {
    process.env.ADMIN_DEV_MODE = 'true';
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: 'not-a-jwt' }),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBeDefined();
  });

  it('returns the dev-mode mock when ADMIN_DEV_MODE=true', async () => {
    process.env.ADMIN_DEV_MODE = 'true';
    const token = await signAdminToken({
      sub: '00000000-0000-4000-8000-000000000099',
      email: 'admin@omyxia.app',
      name: 'Test Admin',
    });
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    // Schema spot-checks (more in metrics-mock.test.ts).
    expect(json.window).toBe('24h');
    expect(typeof json.tenants.total).toBe('number');
    expect(Array.isArray(json.tenantGrowth.points)).toBe(true);
    expect(Array.isArray(json.revenueByPlan)).toBe(true);
  });

  it('recomputes the window for 7d', async () => {
    process.env.ADMIN_DEV_MODE = 'true';
    const token = await signAdminToken({
      sub: '00000000-0000-4000-8000-000000000099',
      email: 'admin@omyxia.app',
      name: 'Test Admin',
    });
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });
    const res = await GET(makeReq('http://localhost:3001/api/admin/metrics?window=7d'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.window).toBe('7d');
  });

  it('defaults an invalid window to 24h', async () => {
    process.env.ADMIN_DEV_MODE = 'true';
    const token = await signAdminToken({
      sub: '00000000-0000-4000-8000-000000000099',
      email: 'admin@omyxia.app',
      name: 'Test Admin',
    });
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });
    const res = await GET(makeReq('http://localhost:3001/api/admin/metrics?window=bogus'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.window).toBe('24h');
  });

  it('proxies + validates the upstream payload when ADMIN_API_URL is set', async () => {
    delete process.env.ADMIN_DEV_MODE;
    process.env.ADMIN_API_URL = 'https://api.omyxia.app';
    const token = await signAdminToken({
      sub: '00000000-0000-4000-8000-000000000099',
      email: 'admin@omyxia.app',
      name: 'Test Admin',
    });
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });

    const upstreamPayload = buildUpstreamPayload();
    const expectedTenantsTotal = (upstreamPayload as { tenants: { total: number } }).tenants.total;

    const fetchedUrl = { value: '' };
    const fetchedHeaders = { value: undefined as Record<string, string> | undefined };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchedUrl.value = String(input);
      fetchedHeaders.value = init?.headers as Record<string, string> | undefined;
      return new Response(JSON.stringify(upstreamPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.window).toBe('24h');
    expect(json.tenants.total).toBe(expectedTenantsTotal);
    expect(fetchedUrl.value).toContain('https://api.omyxia.app/admin/metrics');
    expect(fetchedHeaders.value?.Authorization).toBe(`Bearer ${token}`);
  });

  it('returns 502 when the upstream payload fails schema validation', async () => {
    delete process.env.ADMIN_DEV_MODE;
    process.env.ADMIN_API_URL = 'https://api.omyxia.app';
    const token = await signAdminToken({
      sub: '00000000-0000-4000-8000-000000000099',
      email: 'admin@omyxia.app',
      name: 'Test Admin',
    });
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ broken: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const res = await GET(makeReq());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Upstream metrics schema mismatch');
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it('returns 502 when the upstream throws', async () => {
    delete process.env.ADMIN_DEV_MODE;
    process.env.ADMIN_API_URL = 'https://api.omyxia.app';
    const token = await signAdminToken({
      sub: '00000000-0000-4000-8000-000000000099',
      email: 'admin@omyxia.app',
      name: 'Test Admin',
    });
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });

    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const res = await GET(makeReq());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Metrics upstream failure');
    expect(json.detail).toBe('network down');
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal-but-complete payload that passes
 * `DashboardMetricsSchema`. We use this for the upstream-mock branch
 * of the proxy test so we don't pull the dev mock generator in.
 */
function buildUpstreamPayload(): unknown {
  return {
    generatedAt: '2026-07-04T12:00:00.000Z',
    window: '24h',
    tenants: {
      total: 12,
      active: 10,
      suspended: 1,
      archived: 1,
      netAddsLast7d: 2,
    },
    mrr: {
      totalCents: 5800,
      byPlan: { FREE: 0, PRO: 2900, ENTERPRISE: 2900 },
      plansRanked: ['ENTERPRISE', 'PRO', 'FREE'],
      currency: 'USD',
      period: 'mrr',
    },
    storage: {
      totalBytes: 1024 * 1024 * 1024,
      quotaBytes: 100 * 1024 * 1024 * 1024,
      topTenants: [],
    },
    apiVolume: {
      last24h: 1000,
      last7d: 7000,
      last30d: 30000,
      hourlySeries24h: Array.from({ length: 24 }, (_, h) => ({
        hour: new Date(Date.UTC(2026, 6, 4, h)).toISOString(),
        count: 0,
      })),
    },
    tenantGrowth: {
      days: 30,
      points: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 6, i - 29)).toISOString().slice(0, 10),
        active: 10,
        suspended: 1,
      })),
    },
    revenueByPlan: [
      {
        plan: 'PRO',
        label: 'Pro — $29',
        monthlyCents: 2900,
        share: 0.5,
        color: '#3b82f6',
      },
      {
        plan: 'ENTERPRISE',
        label: 'Enterprise — $299',
        monthlyCents: 2900,
        share: 0.5,
        color: '#8b5cf6',
      },
    ],
  };
}
