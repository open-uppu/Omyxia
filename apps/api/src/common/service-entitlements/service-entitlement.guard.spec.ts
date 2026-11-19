import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ServiceEntitlementGuard } from './service-entitlement.guard';
import { ServiceForbiddenException } from './service-forbidden.exception';
import { REQUIRES_SERVICE_METADATA_KEY } from './requires-service.decorator';
import { ServiceEntitlementHeaderSchema } from '@omyxia/shared-types';

class StubReflector {
  constructor(private readonly store: Record<string, any> = {}) {}
  getAllAndOverride<T>(key: string, _targets: any[]): T | undefined {
    return this.store[key] as T | undefined;
  }
}

function createMockContext(options: {
  path?: string;
  baseUrl?: string;
  user?: any;
  headers?: Record<string, string>;
  handler?: any;
  cls?: any;
}): { context: ExecutionContext; req: any; res: any } {
  const req: any = {
    url: options.path || '/api/v1/erp/journals',
    path: options.path || '/api/v1/erp/journals',
    baseUrl: options.baseUrl || '',
    user: options.user,
    headers: { ...(options.headers || {}) },
  };

  const res: any = {
    headers: {},
    setHeader: vi.fn((k: string, v: string) => {
      res.headers[k] = v;
    }),
  };

  const context: ExecutionContext = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => () => undefined,
    }),
    getHandler: () => options.handler || function testHandler() {},
    getClass: () => options.cls || class TestController {},
  } as unknown as ExecutionContext;

  return { context, req, res };
}

describe('ServiceEntitlementGuard', () => {
  let guard: ServiceEntitlementGuard;
  let mockService: any;
  let mockTenantContext: any;
  let reflector: StubReflector;

  beforeEach(() => {
    mockService = {
      getAccessContext: vi.fn(),
      evaluate: vi.fn(),
    };

    mockTenantContext = {
      get: vi.fn().mockReturnValue(undefined),
    };

    reflector = new StubReflector({});
    guard = new ServiceEntitlementGuard(
      reflector as any,
      mockService,
      mockTenantContext,
    );
  });

  it('allows public unmanaged route with no microservice mapping', async () => {
    const { context } = createMockContext({ path: '/nonexistent/random-page' });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(mockService.getAccessContext).not.toHaveBeenCalled();
  });

  it('allows unauthenticated access to core service endpoints', async () => {
    const { context } = createMockContext({ path: '/api/health' });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('rejects unauthenticated request to protected microservice with 401', async () => {
    const { context } = createMockContext({ path: '/api/v1/erp/journals' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tenant without entitlement with 403 Forbidden containing requiredFeatures and upgradeUrl', async () => {
    const { context } = createMockContext({
      path: '/api/v1/erp/journals',
      user: { activeTenantId: 'tenant-starter', sub: 'user-1', role: 'ADMIN' },
    });

    const accessContext = {
      tenantId: 'tenant-starter',
      userId: 'user-1',
      role: 'ADMIN' as const,
      planTier: 'STARTER' as const,
      entitledServices: ['core', 'workspace', 'hrm', 'crm'] as any[],
      enabledFeatures: [],
      isSuspended: false,
    };

    mockService.getAccessContext.mockResolvedValue(accessContext);
    mockService.evaluate.mockReturnValue({
      allowed: false,
      serviceId: 'erp',
      tenantId: 'tenant-starter',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE', 'FINANCIAL_LEDGERS'],
      upgradeUrl: '/admin/plans?highlight=erp',
    });

    try {
      await guard.canActivate(context);
      expect.fail('Should have thrown ServiceForbiddenException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ServiceForbiddenException);
      const payload = err.getPayload();
      expect(payload.statusCode).toBe(403);
      expect(payload.error).toBe('Forbidden');
      expect(payload.message).toBe("Tenant is not entitled to use the 'erp' microservice");
      expect(payload.requiredFeatures).toEqual(['ERP_CORE', 'FINANCIAL_LEDGERS']);
      expect(payload.requiredFeature).toBe('ERP_CORE');
      expect(payload.upgradeUrl).toBe('/admin/plans?highlight=erp');
    }
  });

  it('allows entitled tenant and injects trusted gateway ingress headers', async () => {
    const { context, req, res } = createMockContext({
      path: '/api/v1/erp/journals',
      user: { activeTenantId: 'tenant-pro', sub: 'user-pro-1', role: 'ACCOUNTANT' },
    });

    const accessContext = {
      tenantId: 'tenant-pro',
      userId: 'user-pro-1',
      role: 'ACCOUNTANT' as const,
      planTier: 'PRO' as const,
      entitledServices: ['core', 'workspace', 'hrm', 'crm', 'erp', 'analytics'] as any[],
      enabledFeatures: ['ERP_CORE'],
      isSuspended: false,
    };

    mockService.getAccessContext.mockResolvedValue(accessContext);
    mockService.evaluate.mockReturnValue({
      allowed: true,
      serviceId: 'erp',
      tenantId: 'tenant-pro',
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);

    // Verify injected headers match ServiceEntitlementHeaderSchema contract
    expect(req.headers['x-tenant-id']).toBe('tenant-pro');
    expect(req.headers['x-user-id']).toBe('user-pro-1');
    expect(req.headers['x-user-role']).toBe('ACCOUNTANT');
    expect(req.headers['x-tenant-plan']).toBe('PRO');
    expect(req.headers['x-entitled-services']).toContain('erp');
    expect(req.headers['x-trace-id']).toBeDefined();

    // Verify Zod validation passes on injected headers
    const parsed = ServiceEntitlementHeaderSchema.safeParse(req.headers);
    expect(parsed.success).toBe(true);

    // Verify response headers
    expect(res.setHeader).toHaveBeenCalledWith('x-tenant-id', 'tenant-pro');
  });

  it('SUPER_ADMIN bypasses all microservice entitlement checks', async () => {
    const { context, req } = createMockContext({
      path: '/api/v1/wms/inventory',
      user: { activeTenantId: 'tenant-any', sub: 'super-admin-user', role: 'SUPER_ADMIN' },
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(mockService.evaluate).not.toHaveBeenCalled();
    expect(req.headers['x-user-role']).toBe('SUPER_ADMIN');
    expect(req.headers['x-tenant-plan']).toBe('ENTERPRISE');
  });

  it('prioritizes explicit @RequiresService decorator metadata over route path', async () => {
    // Custom route path that does not contain 'erp', but decorated with @RequiresService('erp')
    const customReflector = new StubReflector({
      [REQUIRES_SERVICE_METADATA_KEY]: { serviceId: 'erp' },
    });

    const customGuard = new ServiceEntitlementGuard(
      customReflector as any,
      mockService,
      mockTenantContext,
    );

    const { context } = createMockContext({
      path: '/api/custom-endpoint/execute',
      user: { activeTenantId: 'tenant-pro', sub: 'user-1', role: 'ADMIN' },
    });

    mockService.getAccessContext.mockResolvedValue({
      tenantId: 'tenant-pro',
      userId: 'user-1',
      role: 'ADMIN',
      planTier: 'PRO',
      entitledServices: ['core', 'erp'],
      enabledFeatures: ['ERP_CORE'],
      isSuspended: false,
    });
    mockService.evaluate.mockReturnValue({ allowed: true, serviceId: 'erp', tenantId: 'tenant-pro' });

    const result = await customGuard.canActivate(context);
    expect(result).toBe(true);
    expect(mockService.evaluate).toHaveBeenCalledWith(expect.anything(), 'erp');
  });

  it('allows access in soft mode when access is denied', async () => {
    const softReflector = new StubReflector({
      [REQUIRES_SERVICE_METADATA_KEY]: { serviceId: 'erp', options: { soft: true } },
    });

    const softGuard = new ServiceEntitlementGuard(
      softReflector as any,
      mockService,
      mockTenantContext,
    );

    const { context } = createMockContext({
      path: '/api/v1/erp/journals',
      user: { activeTenantId: 'tenant-starter', sub: 'user-1', role: 'ADMIN' },
    });

    mockService.getAccessContext.mockResolvedValue({
      tenantId: 'tenant-starter',
      userId: 'user-1',
      role: 'ADMIN',
      planTier: 'STARTER',
      entitledServices: ['core'],
      enabledFeatures: [],
      isSuspended: false,
    });
    mockService.evaluate.mockReturnValue({
      allowed: false,
      serviceId: 'erp',
      tenantId: 'tenant-starter',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE'],
      upgradeUrl: '/admin/plans?highlight=erp',
    });

    const result = await softGuard.canActivate(context);
    expect(result).toBe(true);
  });
});
