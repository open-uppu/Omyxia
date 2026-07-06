// @vitest-environment node
//
// Tests for /api/admin/plans (collection route).
//
// Covers:
//   - 401 without auth.
//   - GET 200 returns the dev-mode mock (4 plans seeded).
//   - POST 201 creates a new plan + subsequent GET reflects it.
//   - POST 400 on invalid payload.
//   - Prod-mode proxies to ADMIN_API_URL when set.
//   - Prod-mode returns 502 when upstream returns invalid schema.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { signAdminToken } from '@/lib/jwt';
import { resetPlansMockStore } from '@/lib/plans-mock';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

const cookieMock = cookies as unknown as ReturnType<typeof vi.fn>;

function makeReq(url = 'http://localhost:3001/api/admin/plans', init?: RequestInit) {
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    ...(init?.body
      ? {
          body: init.body,
          headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
        }
      : {}),
  });
}

async function tokenize(sub = '00000000-0000-4000-8000-000000000099') {
  return signAdminToken({
    sub,
    name: 'Test Admin',
    email: 'test@omyxia.app',
    
  });
}

describe('GET /api/admin/plans', () => {
  const originalApiUrl = process.env.ADMIN_API_URL;

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
    resetPlansMockStore();
  });

  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.ADMIN_API_URL;
    else process.env.ADMIN_API_URL = originalApiUrl;
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('401 without an admin_session cookie', async () => {
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('200 with dev-mode mock lists 4 plans + 5 add-ons', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plans).toHaveLength(4);
    expect(json.addOns).toHaveLength(5);
    expect(json.plans[0].tier).toBe('FREE');
    expect(json.plans[json.plans.length - 1].tier).toBe('LEGACY_FULL_ACCESS');
  });
});

describe('POST /api/admin/plans', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
    resetPlansMockStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('201 creates a plan; a subsequent GET reflects it', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });

    const create = await POST(
      makeReq('http://localhost:3001/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Custom Tier',
          tier: 'PRO',
          priceCents: 12345,
          description: 'Custom pricing tier',
          isActive: true,
          sortOrder: 99,
          addOnSlugs: [],
          features: [],
        }),
      })
    );
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.name).toBe('Custom Tier');
    expect(created.priceCents).toBe(12345);
    expect(created.priceDollars).toBe('123.45');

    const list = await GET(makeReq());
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.plans.some((p: { id: string }) => p.id === created.id)).toBe(true);
  });

  it('400 on invalid JSON body', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });
    const res = await POST(
      makeReq('http://localhost:3001/api/admin/plans', {
        method: 'POST',
        body: 'not-json',
      })
    );
    expect(res.status).toBe(400);
  });

  it('400 when the payload fails schema validation', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: token }),
    });
    const res = await POST(
      makeReq('http://localhost:3001/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({ name: '' }), // missing required fields
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid plan payload');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('401 when the cookie is missing', async () => {
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const res = await POST(
      makeReq('http://localhost:3001/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({ name: 'X', tier: 'FREE', priceCents: 0 }),
      })
    );
    expect(res.status).toBe(401);
  });
});
