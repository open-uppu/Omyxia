import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_METADATA_KEY } from './roles.decorator';
import type { Role } from './roles';

/**
 * Minimal Reflector stub — returns whatever we configure for a given key.
 */
class StubReflector {
  constructor(private readonly store: Record<string, any>) {}
  getAllAndOverride<T>(key: string, _targets: any[]): T | undefined {
    return this.store[key] as T | undefined;
  }
  getAllAndMerge<T>(key: string, _targets: any[]): T | undefined {
    return this.store[key] as T | undefined;
  }
  get<T>(key: string, _target: any): T | undefined {
    return this.store[key] as T | undefined;
  }
  getAll<T>(key: string, _targets: any[]): T[] {
    const v = this.store[key];
    return v === undefined ? [] : [v as T];
  }
}

function ctxWith(user: any): ExecutionContext {
  const http = {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Foo {},
  } as unknown as ExecutionContext;
  return http;
}

describe('RolesGuard', () => {
  it('passes when no @Roles() metadata is set', () => {
    const reflector = new StubReflector({}) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxWith({ role: 'MEMBER' }))).toBe(true);
  });

  it('passes when user role is in the allowed list', () => {
    const reflector = new StubReflector({ [ROLES_METADATA_KEY]: ['OWNER', 'ADMIN'] as Role[] }) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxWith({ role: 'OWNER' }))).toBe(true);
    expect(guard.canActivate(ctxWith({ role: 'ADMIN' }))).toBe(true);
  });

  it('rejects when user role is not allowed', () => {
    const reflector = new StubReflector({ [ROLES_METADATA_KEY]: ['OWNER'] as Role[] }) as any;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(ctxWith({ role: 'MEMBER' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctxWith({ role: 'VIEWER' }))).toThrow(ForbiddenException);
  });

  it('SUPER_ADMIN bypasses any @Roles() check', () => {
    const reflector = new StubReflector({ [ROLES_METADATA_KEY]: ['OWNER'] as Role[] }) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxWith({ role: 'SUPER_ADMIN' }))).toBe(true);
    const reflector2 = new StubReflector({ [ROLES_METADATA_KEY]: ['MEMBER'] as Role[] }) as any;
    const guard2 = new RolesGuard(reflector2);
    expect(guard2.canActivate(ctxWith({ role: 'SUPER_ADMIN' }))).toBe(true);
  });

  it('rejects when token has no role', () => {
    const reflector = new StubReflector({ [ROLES_METADATA_KEY]: ['OWNER'] as Role[] }) as any;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(ctxWith({}))).toThrow(ForbiddenException);
  });

  it('rejects when role on token is unknown', () => {
    const reflector = new StubReflector({ [ROLES_METADATA_KEY]: ['OWNER'] as Role[] }) as any;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(ctxWith({ role: 'GHOST' }))).toThrow(ForbiddenException);
  });
});