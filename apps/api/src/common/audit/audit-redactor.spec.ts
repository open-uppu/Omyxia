import { describe, expect, it } from 'vitest';
import { redact, SENSITIVE_KEYS } from './audit-redactor';

describe('audit-redactor', () => {
  it('redacts top-level sensitive keys', () => {
    const out = redact({ email: 'a@x.com', password: 'p4ssw0rd', token: 'jwt' });
    expect(out).toEqual({ email: 'a@x.com', password: '[REDACTED]', token: '[REDACTED]' });
  });

  it('redacts nested sensitive keys', () => {
    const out = redact({
      user: { email: 'a@x.com', passwordHash: 'bcrypt$' },
      session: { refreshToken: 'r1', expires: '2024' },
    });
    expect(out).toEqual({
      user: { email: 'a@x.com', passwordHash: '[REDACTED]' },
      session: { refreshToken: '[REDACTED]', expires: '2024' },
    });
  });

  it('is case-insensitive on key match', () => {
    const out = redact({ PASSWORD: 'x', Authorization: 'Bearer x', refresh_token: 'r' });
    expect(out).toEqual({ PASSWORD: '[REDACTED]', Authorization: '[REDACTED]', refresh_token: '[REDACTED]' });
  });

  it('walks arrays', () => {
    const out = redact([{ token: 't1' }, { token: 't2', ok: true }]);
    expect(out).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]', ok: true }]);
  });

  it('preserves null / undefined / primitives', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact('hello')).toBe('hello');
    expect(redact(true)).toBe(true);
  });

  it('handles circular references without infinite loop', () => {
    const a: any = { name: 'x' };
    a.self = a;
    const out = redact(a) as any;
    expect(out.name).toBe('x');
    expect(out.self).toBe('[Circular]');
  });

  it('exposes a non-empty SENSITIVE_KEYS set', () => {
    expect(SENSITIVE_KEYS.size).toBeGreaterThan(5);
    expect(SENSITIVE_KEYS.has('password')).toBe(true);
    expect(SENSITIVE_KEYS.has('token')).toBe(true);
    expect(SENSITIVE_KEYS.has('secret')).toBe(true);
  });
});