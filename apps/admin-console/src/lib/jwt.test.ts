// @vitest-environment node
// Reason: jose's internal `payload instanceof Uint8Array` check fails
// under jsdom because jsdom defines its own Uint8Array on a separate
// realm from Node's. Using the node env keeps TextEncoder/Uint8Array
// unified.
import { describe, expect, it, beforeAll } from 'vitest';
import { signAdminToken, verifyAdminToken, ADMIN_ROLE } from './jwt';

// Ensure a deterministic secret for tests. The jwt module reads
// `process.env.ADMIN_JWT_SECRET` lazily so this assignment sticks.
beforeAll(() => {
  process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-minimum-aaaaaaaaaa';
  process.env.ADMIN_JWT_ISSUER = 'omyxia-admin';
  process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
});

describe('signAdminToken + verifyAdminToken', () => {
  it('round-trips a valid super_admin token', async () => {
    const token = await signAdminToken({
      sub: 'u-1',
      email: 'admin@example.com',
      name: 'Admin One',
    });
    const result = await verifyAdminToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sub).toBe('u-1');
    expect(result.claims.email).toBe('admin@example.com');
    expect(result.claims.name).toBe('Admin One');
    expect(result.claims.role).toBe(ADMIN_ROLE);
  });

  it('rejects an empty token', async () => {
    const result = await verifyAdminToken('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });

  it('rejects garbage', async () => {
    const result = await verifyAdminToken('not-a-jwt');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['invalid', 'malformed']).toContain(result.reason);
  });

  it('rejects a token signed with a different secret', async () => {
    const otherSecret = 'attacker-secret-32-bytes-minimum-aaaaaaaa';
    process.env.ADMIN_JWT_SECRET = otherSecret;
    const token = await signAdminToken({
      sub: 'u-2',
      email: 'evil@example.com',
      name: 'Evil',
    });
    process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-minimum-aaaaaaaaaa';
    const result = await verifyAdminToken(token);
    expect(result.ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    // 1-second TTL, then we wait 1.2s.
    const token = await signAdminToken(
      { sub: 'u-3', email: 'a@a.com', name: 'A' },
      { ttlSeconds: 1 }
    );
    await new Promise((r) => setTimeout(r, 1200));
    const result = await verifyAdminToken(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signAdminToken({
      sub: 'u-4',
      email: 'a@a.com',
      name: 'A',
    });
    process.env.ADMIN_JWT_AUDIENCE = 'someone-else.example.com';
    const result = await verifyAdminToken(token);
    process.env.ADMIN_JWT_AUDIENCE = 'admin.omyxia.app';
    expect(result.ok).toBe(false);
  });
});