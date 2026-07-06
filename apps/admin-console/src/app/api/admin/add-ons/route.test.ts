// @vitest-environment node
//
// Tests for /api/admin/add-ons and /api/admin/add-ons/[id].

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST as POST_LIST } from './route';
import { GET as GET_BY_ID, PATCH as PATCH_BY_ID, DELETE as DELETE_BY_ID } from './[id]/route';
import { GET as PLANS_GET } from '../plans/route';
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

describe('GET /api/admin/add-ons', () => {
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

  it('200 lists the 5 seeded add-ons', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await GET(makeReq('http://localhost:3001/api/admin/add-ons'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.addOns).toHaveLength(5);
    expect(json.addOns[0].slug).toBe('addon.bi');
  });
});

describe('POST /api/admin/add-ons', () => {
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

  it('201 creates an add-on with derived slug', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await POST_LIST(
      makeReq('http://localhost:3001/api/admin/add-ons', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Quality Assurance',
          priceCents: 2000,
          description: 'Test module',
          appliesTo: 'PRO',
          isActive: true,
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe('addon.quality_assurance');
    expect(body.appliesTo).toBe('PRO');
  });

  it('400 on schema violation', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await POST_LIST(
      makeReq('http://localhost:3001/api/admin/add-ons', {
        method: 'POST',
        body: JSON.stringify({ name: '', priceCents: -1 }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/add-ons/[id]', () => {
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

  it('200 returns the add-on', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await GET_BY_ID(
      makeReq('http://localhost:3001/api/admin/add-ons/ao_crm'),
      { params: { id: 'ao_crm' } } as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('addon.crm');
  });

  it('404 when missing', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await GET_BY_ID(
      makeReq('http://localhost:3001/api/admin/add-ons/ao_nope'),
      { params: { id: 'ao_nope' } } as never
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/add-ons/[id]', () => {
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

  it('200 patches priceCents + appliesTo', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await PATCH_BY_ID(
      makeReq('http://localhost:3001/api/admin/add-ons/ao_crm', {
        method: 'PATCH',
        body: JSON.stringify({ priceCents: 7700, appliesTo: 'PRO' }),
      }),
      { params: { id: 'ao_crm' } } as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priceCents).toBe(7700);
    expect(body.appliesTo).toBe('PRO');
  });

  it('404 when the add-on does not exist', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const res = await PATCH_BY_ID(
      makeReq('http://localhost:3001/api/admin/add-ons/ao_nope', {
        method: 'PATCH',
        body: JSON.stringify({ priceCents: 1 }),
      }),
      { params: { id: 'ao_nope' } } as never
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/add-ons/[id]', () => {
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
    const res = await DELETE_BY_ID(
      makeReq('http://localhost:3001/api/admin/add-ons/ao_crm'),
      { params: { id: 'ao_crm' } } as never
    );
    expect(res.status).toBe(204);
  });

  it('removes the slug from any plan that bundled it', async () => {
    const token = await tokenize();
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    await DELETE_BY_ID(
      makeReq('http://localhost:3001/api/admin/add-ons/ao_crm'),
      { params: { id: 'ao_crm' } } as never
    );
    const list = await GET(makeReq('http://localhost:3001/api/admin/add-ons'));
    const json = await list.json();
    expect(json.addOns.find((a: { id: string }) => a.id === 'ao_crm')).toBeUndefined();
    // Now check plans.
    cookieMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: token }) });
    const plansRes = await PLANS_GET(
      makeReq('http://localhost:3001/api/admin/plans')
    );
    const plansJson = await plansRes.json();
    const pro = plansJson.plans.find((p: { id: string }) => p.id === 'p_pro');
    const ent = plansJson.plans.find((p: { id: string }) => p.id === 'p_enterprise');
    expect(pro.addOnSlugs).not.toContain('addon.crm');
    expect(ent.addOnSlugs).not.toContain('addon.crm');
  });
});
