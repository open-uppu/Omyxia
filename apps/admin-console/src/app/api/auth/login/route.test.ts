// @vitest-environment node
// Reason: see src/lib/jwt.test.ts — jose's Uint8Array instanceof
// check fails under jsdom. The login route mints a JWT, so it must
// run under the Node env.

/**
 * API route tests for /api/auth/login.
 *
 * We import the route handler directly and stub `fetch` for the
 * upstream-proxy branch.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// Force dev mode BEFORE the route module is imported so the closure
// captures it.
process.env.ADMIN_DEV_MODE = 'true';
process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-minimum-aaaaaaaaaa';

import { POST } from './route';
import { NextRequest } from 'next/server';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/login (dev mode)', () => {
  beforeEach(() => {
    delete process.env.ADMIN_API_URL;
  });

  it('returns 400 for non-JSON / empty body', async () => {
    const req = new NextRequest('http://localhost/api/auth/login', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing fields', async () => {
    const res = await POST(makeRequest({ email: '', password: '' }));
    expect(res.status).toBe(400);
  });

  it('mints a JWT for the bootstrap credentials', async () => {
    const res = await POST(
      makeRequest({ email: 'admin@omyxia.app', password: 'admin' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.token.split('.').length).toBe(3);
    expect(body.user.email).toBe('admin@omyxia.app');
    expect(body.user.role).toBe('super_admin');
    expect(body.devMode).toBe(true);
  });

  it('returns 503 when credentials do not match dev bootstrap AND ADMIN_API_URL is unset', async () => {
    const res = await POST(
      makeRequest({ email: 'real@user.com', password: 'real-password' })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Backend auth is not configured/i);
  });

  it('proxies to backend when ADMIN_API_URL is set and dev bootstrap does not match', async () => {
    process.env.ADMIN_API_URL = 'https://api.omyxia.app';
    const upstreamFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ token: 'real.jwt.from.backend' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    globalThis.fetch = upstreamFetch as unknown as typeof fetch;

    const res = await POST(
      makeRequest({ email: 'real@user.com', password: 'real-password' })
    );
    expect(res.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://api.omyxia.app/admin/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
    const body = await res.json();
    expect(body.token).toBe('real.jwt.from.backend');
  });
});