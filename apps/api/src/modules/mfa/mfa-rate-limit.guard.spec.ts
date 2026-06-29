import { beforeEach, describe, expect, it } from 'vitest';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { MfaRateLimitGuard } from './mfa-rate-limit.guard';

function ctxWith(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('MfaRateLimitGuard', () => {
  let guard: MfaRateLimitGuard;

  beforeEach(() => {
    guard = new MfaRateLimitGuard();
  });

  it('passes the first 5 attempts within 60s', () => {
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }))).toBe(true);
    }
  });

  it('throws 429 on the 6th attempt', () => {
    for (let i = 0; i < 5; i++) {
      guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }));
    }
    expect(() => guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }))).toThrow(HttpException);
  });

  it('isolates buckets per user', () => {
    for (let i = 0; i < 5; i++) {
      guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }));
    }
    expect(() => guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }))).toThrow(HttpException);
    // u-2 still has full quota
    expect(guard.canActivate(ctxWith({ user: { sub: 'u-2' }, route: { path: '/mfa/verify' } }))).toBe(true);
  });

  it('falls back to ip when no user', () => {
    for (let i = 0; i < 5; i++) {
      guard.canActivate(ctxWith({ ip: '1.2.3.4', route: { path: '/mfa/verify' } }));
    }
    expect(() => guard.canActivate(ctxWith({ ip: '1.2.3.4', route: { path: '/mfa/verify' } }))).toThrow(HttpException);
    // Different IP gets a fresh bucket
    expect(guard.canActivate(ctxWith({ ip: '5.6.7.8', route: { path: '/mfa/verify' } }))).toBe(true);
  });

  it('reset() clears buckets (test helper)', () => {
    for (let i = 0; i < 5; i++) {
      guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }));
    }
    guard.reset();
    expect(guard.canActivate(ctxWith({ user: { sub: 'u-1' }, route: { path: '/mfa/verify' } }))).toBe(true);
  });
});