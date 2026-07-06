// @vitest-environment node
import { describe, expect, it, beforeAll, vi } from 'vitest';

beforeAll(() => {
  process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-minimum-aaaaaaaaaa';
  process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
  process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
});

import { GET } from './route';
import { NextRequest } from 'next/server';
import { signAdminToken } from '@/lib/jwt';

function requestWithCookie(token?: string): NextRequest {
  const req = new NextRequest('http://localhost/api/auth/me', { method: 'GET' });
  if (token) {
    req.cookies.set('admin_session', token);
  }
  return req;
}

describe('GET /api/auth/me', () => {
  it('returns 401 when there is no cookie', async () => {
    const res = await GET(requestWithCookie());
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed cookie', async () => {
    const res = await GET(requestWithCookie('not-a-jwt'));
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid super_admin token', async () => {
    const token = await signAdminToken({
      sub: 'u-99',
      email: 'admin@omyxia.app',
      name: 'Bootstrap Admin',
    });
    const res = await GET(requestWithCookie(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('u-99');
    expect(body.email).toBe('admin@omyxia.app');
    expect(body.role).toBe('super_admin');
  });
});