import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api, ApiError } from '@/lib/api';

describe('API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('switches tenant by calling POST /api/tenants/:id/switch with credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            user: { id: 'u1', email: 'a@b.com', name: 'A' },
            tenant: { id: 't2', slug: 'globex', name: 'Globex', role: 'ADMIN' },
            accessToken: 'tok',
            expiresAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    await api.tenants.switch('t2');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('/api/tenants/t2/switch');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.credentials).toBe('same-origin');
  });

  it('encodes tenant id in URL to be URL-safe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    await api.tenants.switch('tenant id with space');
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/tenants/tenant%20id%20with%20space/switch');
  });

  it('parses JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, remainingRecoveryCodes: 8 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const s = await api.mfa.status();
    expect(s.enabled).toBe(true);
    expect(s.remainingRecoveryCodes).toBe(8);
  });

  it('throws ApiError with status and body on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Code expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    let captured: unknown;
    try {
      await api.mfa.verify('000000');
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(401);
    expect((captured as ApiError).message).toMatch(/code expired/i);
  });

  it('falls back to status-based message when API has no message body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', { status: 500, headers: { 'Content-Type': 'text/plain' } })
    );
    try {
      await api.mfa.verify('000000');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ApiError).status).toBe(500);
    }
  });

  it('login sends JSON body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await api.auth.login({ email: 'a@b.com', password: 'pwpwpwpw' });
    expect(fetchSpy.mock.calls[0]![1]?.body).toBe(
      JSON.stringify({ email: 'a@b.com', password: 'pwpwpwpw' })
    );
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe('POST');
  });
});
