import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { FeatureGateGuard } from './feature-gate.guard';
import { FeatureForbiddenException } from './feature-forbidden.exception';
import { mkEntitlements, mkPrismaStub, mkRedisStub } from './__fixtures__';
import {
  FEATURE_METADATA_KEY,
} from './requires-feature.decorator';

/**
 * Minimal Reflector stub (matches the contract the real one exposes).
 */
class StubReflector {
  constructor(private readonly store: Record<string, any>) {}
  getAllAndOverride<T>(key: string, _targets: any[]): T | undefined {
    return this.store[key] as T | undefined;
  }
  getAllAndMerge<T>(key: string, _targets: any[]): T | undefined {
    return this.store[key] as T | undefined;
  }
}

function ctxWith(req: any): ExecutionContext {
  const http = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Foo {},
  } as unknown as ExecutionContext;
  return http;
}

describe('FeatureGateGuard', () => {
  let guard: FeatureGateGuard;
  let entitlements: any;
  let tenantContext: any;
  let usage: any;

  beforeEach(() => {
    entitlements = { forTenant: vi.fn() };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    usage = { count: vi.fn().mockResolvedValue(0) };
  });

  function makeGuard(reflector: any) {
    return new FeatureGateGuard(reflector, entitlements, tenantContext, usage);
  }

  it('passes when no @RequiresFeature metadata is set', async () => {
    const reflector = new StubReflector({});
    const g = makeGuard(reflector);
    await expect(g.canActivate(ctxWith({}))).resolves.toBe(true);
  });

  it('SUPER_ADMIN bypasses every feature gate', async () => {
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: {
        feature: 'module.crm',
        options: {},
      },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'SUPER_ADMIN', tenantId: 'tenant-1' },
      originalUrl: '/crm/pipelines',
      headers: {},
    };
    await expect(g.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(entitlements.forTenant).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when no tenant context can be resolved', async () => {
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: { feature: 'module.crm', options: {} },
    });
    const g = makeGuard(reflector);
    const req = { user: { role: 'MEMBER' }, originalUrl: '/x', headers: {} };
    tenantContext.getTenantId.mockReturnValueOnce(undefined);
    await expect(g.canActivate(ctxWith(req))).rejects.toThrow(ForbiddenException);
  });

  it('passes when the requested module feature is enabled on the plan', async () => {
    entitlements.forTenant.mockResolvedValueOnce(mkEntitlements());
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: { feature: 'module.crm', options: {} },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'OWNER', tenantId: 'tenant-1' },
      originalUrl: '/crm/pipelines',
      headers: {},
    };
    await expect(g.canActivate(ctxWith(req))).resolves.toBe(true);
  });

  it('throws FeatureForbiddenException when the module feature is disabled', async () => {
    entitlements.forTenant.mockResolvedValue(
      mkEntitlements({
        features: { 'module.bi': false },
      }),
    );
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: { feature: 'module.bi', options: {} },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'OWNER', tenantId: 'tenant-1' },
      originalUrl: '/bi/dashboards',
      headers: {},
    };

    let exc: FeatureForbiddenException | null = null;
    try {
      await g.canActivate(ctxWith(req));
      throw new Error('expected throw');
    } catch (err) {
      exc = err as FeatureForbiddenException;
    }

    expect(exc).toBeInstanceOf(FeatureForbiddenException);
    expect(exc!.payload.code).toBe('FEATURE_NOT_INCLUDED');
    expect(exc!.payload.feature).toBe('module.bi');
    expect(exc!.payload.upgradeUrl).toContain('/upgrade?');
    expect(exc!.payload.recommendedPlan).toBe('ENTERPRISE');
    expect(exc!.payload.tenantId).toBe('tenant-1');
    expect(exc!.payload.currentPlan).toBe('PRO');
  });

  it('throws on unknown / typo feature keys (fail-closed)', async () => {
    entitlements.forTenant.mockResolvedValueOnce(mkEntitlements());
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: { feature: 'module.cm', options: {} },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'OWNER', tenantId: 'tenant-1' },
      originalUrl: '/x',
      headers: {},
    };

    await expect(g.canActivate(ctxWith(req))).rejects.toThrow(
      FeatureForbiddenException,
    );
  });

  it('passes a limit check when limit is null (unlimited)', async () => {
    entitlements.forTenant.mockResolvedValueOnce(
      mkEntitlements({
        limits: { 'limit.maxLeads': null },
      }),
    );
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: {
        feature: 'limit.maxLeads',
        options: { max: 1000 },
      },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'OWNER', tenantId: 'tenant-1' },
      originalUrl: '/crm/leads',
      headers: {},
    };
    await expect(g.canActivate(ctxWith(req))).resolves.toBe(true);
  });

  it('throws when a limit feature is not configured on the plan', async () => {
    entitlements.forTenant.mockResolvedValueOnce(mkEntitlements());
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: { feature: 'limit.maxBackupGB', options: {} },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'OWNER', tenantId: 'tenant-1' },
      originalUrl: '/backup',
      headers: {},
    };

    await expect(g.canActivate(ctxWith(req))).rejects.toThrow(
      FeatureForbiddenException,
    );
  });

  it('soft: true logs the denial but lets the request through', async () => {
    entitlements.forTenant.mockResolvedValueOnce(
      mkEntitlements({ features: { 'module.bi': false } }),
    );
    const reflector = new StubReflector({
      [FEATURE_METADATA_KEY]: {
        feature: 'module.bi',
        options: { soft: true },
      },
    });
    const g = makeGuard(reflector);
    const req = {
      user: { userId: 'u-1', role: 'OWNER', tenantId: 'tenant-1' },
      originalUrl: '/bi',
      headers: {},
    };
    await expect(g.canActivate(ctxWith(req))).resolves.toBe(true);
  });

  describe('checkLimit (programmatic)', () => {
    it('reports FEATURE_LIMIT_EXCEEDED when requested max > limit', async () => {
      entitlements.forTenant.mockResolvedValueOnce(
        mkEntitlements({ limits: { 'limit.maxEmployees': 25 } }),
      );
      const g = makeGuard(new StubReflector({}));
      const out = await g.checkLimit('tenant-1', 'limit.maxEmployees', 30);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.payload.code).toBe('FEATURE_LIMIT_EXCEEDED');
        expect(out.payload.currentLimit).toBe(25);
        expect(out.payload.requiredMax).toBe(30);
      }
    });

    it('returns ok when requested max ≤ limit', async () => {
      entitlements.forTenant.mockResolvedValueOnce(
        mkEntitlements({ limits: { 'limit.maxEmployees': 25 } }),
      );
      const g = makeGuard(new StubReflector({}));
      const out = await g.checkLimit('tenant-1', 'limit.maxEmployees', 10);
      expect(out.ok).toBe(true);
    });

    it('returns ok when limit is null (unlimited)', async () => {
      entitlements.forTenant.mockResolvedValueOnce(
        mkEntitlements({ limits: { 'limit.maxLeads': null } }),
      );
      const g = makeGuard(new StubReflector({}));
      const out = await g.checkLimit('tenant-1', 'limit.maxLeads', 1_000_000);
      expect(out.ok).toBe(true);
    });
  });
});
