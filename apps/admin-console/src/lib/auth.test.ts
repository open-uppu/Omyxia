import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  readAdminCookie,
  writeAdminCookie,
  clearAdminCookie,
  decodeClaims,
  getCurrentClaims,
  ADMIN_COOKIE,
} from './auth';

function setCookie(value: string | null) {
  Object.defineProperty(document, 'cookie', {
    value: value ?? '',
    writable: true,
    configurable: true,
  });
}

describe('admin cookie helpers', () => {
  beforeEach(() => {
    setCookie(null);
  });
  afterEach(() => {
    setCookie(null);
  });

  it('readAdminCookie returns null when no cookie is set', () => {
    expect(readAdminCookie()).toBeNull();
  });

  it('writeAdminCookie + readAdminCookie round-trip', () => {
    writeAdminCookie('abc.def.ghi');
    const v = readAdminCookie();
    expect(v).toBe('abc.def.ghi');
  });

  it('clearAdminCookie removes the cookie', () => {
    writeAdminCookie('xxx');
    clearAdminCookie();
    // After clear, document.cookie contains an empty entry which should
    // not be returned (the helper checks `startsWith(prefix)`).
    expect(readAdminCookie()).toBeNull();
  });

  it('readAdminCookie handles special characters via URL encoding', () => {
    // Simulate a server-set cookie with URL-encoded payload (rare but legal).
    document.cookie = `${ADMIN_COOKIE}=${encodeURIComponent('a/b+c=')}; Path=/`;
    expect(readAdminCookie()).toBe('a/b+c=');
  });
});

describe('decodeClaims', () => {
  // Build a tiny base64url-encoded payload for testing without jose.
  function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const body = Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${header}.${body}.signature`;
  }

  it('decodes a valid super_admin payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = fakeJwt({
      sub: 'u-1',
      email: 'a@a.com',
      name: 'A',
      role: 'super_admin',
      iat: Math.floor(Date.now() / 1000),
      exp,
    });
    const claims = decodeClaims(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('u-1');
    expect(claims!.role).toBe('super_admin');
  });

  it('returns null for a non-super_admin payload', () => {
    const token = fakeJwt({
      sub: 'u-1',
      email: 'a@a.com',
      name: 'A',
      role: 'tenant_owner',
    });
    expect(decodeClaims(token)).toBeNull();
  });

  it('returns null for malformed JWT', () => {
    expect(decodeClaims('not-a-jwt')).toBeNull();
    expect(decodeClaims('a.b')).toBeNull();
    expect(decodeClaims('a.b.c.d')).toBeNull();
  });

  it('falls back to email when name is missing', () => {
    const token = fakeJwt({
      sub: 'u-1',
      email: 'a@a.com',
      role: 'super_admin',
    });
    const claims = decodeClaims(token);
    expect(claims?.name).toBe('a@a.com');
  });
});

describe('getCurrentClaims', () => {
  beforeEach(() => {
    setCookie(null);
  });

  it('returns null when there is no cookie', () => {
    expect(getCurrentClaims()).toBeNull();
  });

  it('returns the decoded claims when the cookie is set + valid', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = Buffer.from('{"alg":"none"}').toString('base64').replace(/=+$/, '');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u-2', email: 'b@b.com', name: 'B', role: 'super_admin', exp })
    )
      .toString('base64')
      .replace(/=+$/, '');
    setCookie(`${ADMIN_COOKIE}=${header}.${body}.sig`);
    const claims = getCurrentClaims();
    expect(claims).not.toBeNull();
    expect(claims!.email).toBe('b@b.com');
  });

  it('returns null for an expired token in the cookie', () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const header = Buffer.from('{"alg":"none"}').toString('base64').replace(/=+$/, '');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u-3', email: 'c@c.com', name: 'C', role: 'super_admin', exp })
    )
      .toString('base64')
      .replace(/=+$/, '');
    setCookie(`${ADMIN_COOKIE}=${header}.${body}.sig`);
    expect(getCurrentClaims()).toBeNull();
  });
});