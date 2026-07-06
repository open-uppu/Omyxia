import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';

describe('POST /api/auth/logout', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('always returns 200 and clears the cookie even without ADMIN_API_URL', async () => {
    delete process.env.ADMIN_API_URL;
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(/admin_session=/);
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  it('best-effort calls the backend logout endpoint when ADMIN_API_URL is set', async () => {
    process.env.ADMIN_API_URL = 'https://api.omyxia.app';
    const upstreamFetch = vi.fn().mockResolvedValue({ status: 204 });
    globalThis.fetch = upstreamFetch as unknown as typeof fetch;

    const res = await POST();
    expect(res.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://api.omyxia.app/admin/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('still returns 200 when the backend logout fails', async () => {
    process.env.ADMIN_API_URL = 'https://api.omyxia.app';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;

    const res = await POST();
    expect(res.status).toBe(200);
  });
});