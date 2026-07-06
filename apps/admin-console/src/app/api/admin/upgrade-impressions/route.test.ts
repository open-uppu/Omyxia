// @vitest-environment node
//
// Tests for POST /api/admin/upgrade-impressions. We stub cookies +
// verifyAdminToken via vi.mock so the route handler can run in Node.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock next/headers so we can inject the cookie store from the test.
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/jwt', () => ({
  verifyAdminToken: vi.fn(),
}));

import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/jwt';

const cookieMock = cookies as unknown as ReturnType<typeof vi.fn>;
const verifyAdminTokenMock = verifyAdminToken as unknown as ReturnType<typeof vi.fn>;

/**
 * Sentinel token for the test harness. Use `null` to mean "no
 * cookie" — we cannot use `undefined` because the default parameter
 * value would then be applied (so makeReq({...}, undefined) would
 * NOT result in token=undefined).
 */
type TokenOption = string | null;

function makeReq(body: unknown, token: TokenOption = 'valid-token') {
  const inner = vi.fn();
  inner.mockReturnValue(token !== null ? { value: token } : null);
  cookieMock.mockReturnValue({ get: inner });
  return new NextRequest(
    new Request('http://localhost/api/admin/upgrade-impressions', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function makeRawReq(rawBody: string, token: TokenOption = 'valid-token') {
  const inner = vi.fn();
  inner.mockReturnValue(token !== null ? { value: token } : null);
  cookieMock.mockReturnValue({ get: inner });
  return new NextRequest(
    new Request('http://localhost/api/admin/upgrade-impressions', {
      method: 'POST',
      body: rawBody,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function validClaims() {
  return {
    ok: true,
    claims: {
      sub: 'u-1',
      email: 'admin@omyxia.app',
      name: 'Admin',
      role: 'super_admin',
    },
  };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'shown',
    feature: 'module.crm',
    shownAt: '2026-07-04T12:00:00.000Z',
    at: '2026-07-04T12:00:01.000Z',
    currentPlan: 'FREE',
    recommendedPlan: 'PRO',
    ...overrides,
  };
}

describe('POST /api/admin/upgrade-impressions', () => {
  beforeEach(() => {
    delete process.env.ADMIN_API_URL;
    delete process.env.ADMIN_DEV_MODE;
  });

  afterEach(() => {
    delete process.env.ADMIN_API_URL;
    delete process.env.ADMIN_DEV_MODE;
    cookieMock.mockReset();
    verifyAdminTokenMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns 401 when no cookie is present', async () => {
    const res = await POST(makeReq({ events: [] }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the JWT is invalid', async () => {
    verifyAdminTokenMock.mockResolvedValueOnce({ ok: false, reason: 'expired' });
    const res = await POST(makeReq({ events: [] }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the body is not valid JSON', async () => {
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const res = await POST(makeRawReq('not-json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body does not match the schema', async () => {
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const res = await POST(makeReq({ events: [{ kind: 'exploded' }] }));
    expect(res.status).toBe(400);
  });

  it('returns 204 in dev mode for a valid batch', async () => {
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const res = await POST(makeReq({ events: [validEvent()] }));
    expect(res.status).toBe(204);
  });

  it('caps the batch at 100 events (more → 400)', async () => {
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const events = Array.from({ length: 101 }, () => validEvent());
    const res = await POST(makeReq({ events }));
    expect(res.status).toBe(400);
  });

  it('proxies to the backend in production mode', async () => {
    process.env.ADMIN_API_URL = 'https://api.example.test';
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(makeReq({ events: [validEvent()] }));
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/admin/upgrade-impressions');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('returns 502 when the upstream returns 5xx', async () => {
    process.env.ADMIN_API_URL = 'https://api.example.test';
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(makeReq({ events: [validEvent()] }));
    expect(res.status).toBe(502);
  });

  it('returns 502 when the upstream fetch throws', async () => {
    process.env.ADMIN_API_URL = 'https://api.example.test';
    verifyAdminTokenMock.mockResolvedValueOnce(validClaims());
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(makeReq({ events: [validEvent()] }));
    expect(res.status).toBe(502);
  });
});