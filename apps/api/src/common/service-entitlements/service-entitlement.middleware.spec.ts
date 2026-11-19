import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ServiceEntitlementMiddleware } from './service-entitlement.middleware';

describe('ServiceEntitlementMiddleware', () => {
  let middleware: ServiceEntitlementMiddleware;
  let mockService: any;
  let mockTenantContext: any;

  beforeEach(() => {
    mockService = {
      getAccessContext: vi.fn(),
      evaluate: vi.fn(),
    };
    mockTenantContext = {
      get: vi.fn().mockReturnValue(null),
    };

    middleware = new ServiceEntitlementMiddleware(mockService, mockTenantContext);
  });

  it('bypasses routes not mapped to any microservice', async () => {
    const req: any = { path: '/favicon.ico', baseUrl: '', headers: {} };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockService.getAccessContext).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated user accesses restricted microservice', async () => {
    const req: any = { path: '/api/v1/erp/journals', baseUrl: '', headers: {} };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await middleware.use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        error: 'Unauthorized',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 Forbidden with payload when tenant is not entitled', async () => {
    const req: any = {
      path: '/api/v1/erp/journals',
      baseUrl: '',
      user: { activeTenantId: 'tenant-free', sub: 'u1', role: 'MEMBER' },
      headers: {},
    };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mockService.getAccessContext.mockResolvedValue({
      tenantId: 'tenant-free',
      userId: 'u1',
      role: 'MEMBER',
      planTier: 'FREE',
      entitledServices: ['core', 'workspace'],
      enabledFeatures: [],
      isSuspended: false,
    });

    mockService.evaluate.mockReturnValue({
      allowed: false,
      serviceId: 'erp',
      tenantId: 'tenant-free',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE', 'FINANCIAL_LEDGERS'],
      upgradeUrl: '/admin/plans?highlight=erp',
    });

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 403,
      error: 'Forbidden',
      message: "Tenant is not entitled to use the 'erp' microservice",
      serviceId: 'erp',
      tenantId: 'tenant-free',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE', 'FINANCIAL_LEDGERS'],
      requiredFeature: 'ERP_CORE',
      upgradeUrl: '/admin/plans?highlight=erp',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows entitled tenant and injects gateway headers', async () => {
    const req: any = {
      path: '/api/v1/erp/journals',
      baseUrl: '',
      user: { activeTenantId: 'tenant-pro', sub: 'u2', role: 'ADMIN' },
      headers: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    mockService.getAccessContext.mockResolvedValue({
      tenantId: 'tenant-pro',
      userId: 'u2',
      role: 'ADMIN',
      planTier: 'PRO',
      entitledServices: ['core', 'workspace', 'hrm', 'crm', 'erp', 'analytics'],
      enabledFeatures: ['ERP_CORE'],
      isSuspended: false,
    });

    mockService.evaluate.mockReturnValue({
      allowed: true,
      serviceId: 'erp',
      tenantId: 'tenant-pro',
    });

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.headers['x-tenant-id']).toBe('tenant-pro');
    expect(req.headers['x-user-role']).toBe('ADMIN');
    expect(req.headers['x-tenant-plan']).toBe('PRO');
    expect(req.headers['x-entitled-services']).toContain('erp');
  });
});
