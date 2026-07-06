// @vitest-environment node
//
// Tests for /api/admin/plans/[id] (single-plan CRUD) and the
// /api/admin/plans/[id]/features/reorder subroute.
//
// Covers:
//   - GET 200/404, PATCH 200/404/400, DELETE 204/404.
//   - Reorder POST 200/400/404.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from './route';
import { POST as reorder } from './features/reorder/route';
import { signAdminToken } from '@/lib/jwt';
import { resetPlansMockStore } from '@/lib/plans-mock';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

const cookieMock = cookies as unknown as ReturnType<typeof vi.fn>;

function makeReq(url: string, init?: RequestInit) {
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    ...(init?.body
      ? {
          body: init.body,
          headers: { 'content-type': 'application/json' },
        }
      : {}),
  });
}

async function tokenize() {
  return signAdminToken({
    sub: '00000000-0000-4000-8000-000000000099',
    name: 'Test Admin',
    email: 'test@omyxia.app',
    
  });
}

describe('GET /api/admin/plans/[id]', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    resetPlansMockStore();
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('200 returns the plan when it exists', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await GET(makeReq('http://localhost:3001/api/admin/plans/p_pro'), {
      params: { id: 'p_pro' },
    } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('p_pro');
    expect(body.tier).toBe('PRO');
  });

  it('404 when the plan does not exist', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await GET(
      makeReq('http://localhost:3001/api/admin/plans/p_nope'),
      { params: { id: 'p_nope' } } as never
    );
    expect(res.status).toBe(404);
  });

  it('401 without a cookie', async () => {
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const res = await GET(makeReq('http://localhost:3001/api/admin/plans/p_pro'), {
      params: { id: 'p_pro' },
    } as never);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/admin/plans/[id]', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    resetPlansMockStore();
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('200 patches the plan and reflects the new price', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await PATCH(
      makeReq('http://localhost:3001/api/admin/plans/p_pro', {
        method: 'PATCH',
        body: JSON.stringify({ priceCents: 19900 }),
      }),
      { params: { id: 'p_pro' } } as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priceCents).toBe(19900);
    expect(body.priceDollars).toBe('199.00');
  });

  it('400 on invalid JSON', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await PATCH(
      makeReq('http://localhost:3001/api/admin/plans/p_pro', {
        method: 'PATCH',
        body: '{not-json',
      }),
      { params: { id: 'p_pro' } } as never
    );
    expect(res.status).toBe(400);
  });

  it('400 on schema-violating payload', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await PATCH(
      makeReq('http://localhost:3001/api/admin/plans/p_pro', {
        method: 'PATCH',
        body: JSON.stringify({ priceCents: -5 }),
      }),
      { params: { id: 'p_pro' } } as never
    );
    expect(res.status).toBe(400);
  });

  it('404 when the plan does not exist', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await PATCH(
      makeReq('http://localhost:3001/api/admin/plans/p_nope', {
        method: 'PATCH',
        body: JSON.stringify({ priceCents: 0 }),
      }),
      { params: { id: 'p_nope' } } as never
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/plans/[id]', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    resetPlansMockStore();
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('204 on success', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await DELETE(makeReq('http://localhost:3001/api/admin/plans/p_pro'), {
      params: { id: 'p_pro' },
    } as never);
    expect(res.status).toBe(204);
  });

  it('404 when the plan does not exist', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await DELETE(
      makeReq('http://localhost:3001/api/admin/plans/p_nope'),
      { params: { id: 'p_nope' } } as never
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/plans/[id]/features/reorder', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'dev-only-secret-change-me-please-32bytes-min';
    process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
    resetPlansMockStore();
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    delete process.env.ADMIN_API_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cookieMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('200 returns the plan with reordered features', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const list = await fetchList(token);
    const pro = list.plans.find((p: { id: string }) => p.id === 'p_pro');
    expect(pro).toBeDefined();
    const keys = pro!.features.map((f: { featureKey: string }) => f.featureKey);
    const reversed = [...keys].reverse();

    const res = await reorder(
      makeReq('http://localhost:3001/api/admin/plans/p_pro/features/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedFeatureKeys: reversed }),
      }),
      { params: { id: 'p_pro' } } as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features.map((f: { featureKey: string }) => f.featureKey)).toEqual(reversed);
  });

  it('400 on empty orderedFeatureKeys', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await reorder(
      makeReq('http://localhost:3001/api/admin/plans/p_pro/features/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedFeatureKeys: [] }),
      }),
      { params: { id: 'p_pro' } } as never
    );
    expect(res.status).toBe(400);
  });

  it('404 when plan does not exist', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await reorder(
      makeReq('http://localhost:3001/api/admin/plans/p_nope/features/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedFeatureKeys: ['module.email'] }),
      }),
      { params: { id: 'p_nope' } } as never
    );
    expect(res.status).toBe(404);
  });

  it('401 without a cookie', async () => {
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const res = await reorder(
      makeReq('http://localhost:3001/api/admin/plans/p_pro/features/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedFeatureKeys: ['module.email'] }),
      }),
      { params: { id: 'p_pro' } } as never
    );
    expect(res.status).toBe(401);
  });
});

/**
 * Fetch the canonical plan list so we know the seeded feature-key order.
 * Returns the full list response (callers index into `.plans`).
 */
async function fetchList(token: string): Promise<{
  plans: Array<{
    id: string;
    features: Array<{ featureKey: string }>;
  }>;
}> {
  const { GET: PLANS_GET } = await import('../route');
  cookieMock.mockReturnValue({
    get: vi.fn().mockReturnValue({ value: token }),
  });
  const res = await PLANS_GET(makeReq('http://localhost:3001/api/admin/plans'));
  const json = await res.json();
  return json;
}
