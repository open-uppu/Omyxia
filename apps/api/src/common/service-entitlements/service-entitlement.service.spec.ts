import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ServiceEntitlementService } from './service-entitlement.service';

describe('ServiceEntitlementService', () => {
  let service: ServiceEntitlementService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      tenant: {
        findUnique: vi.fn(),
      },
      tenantEntitlement: {
        findFirst: vi.fn(),
      },
    };

    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      publish: vi.fn(),
    };

    service = new ServiceEntitlementService(mockPrisma as any, mockRedis as any);
  });

  it('reads from Redis cache on cache hit', async () => {
    const cachedContext = {
      tenantId: 'tenant-101',
      userId: 'user-1',
      role: 'ADMIN',
      planTier: 'PRO',
      entitledServices: ['core', 'workspace', 'hrm', 'crm', 'erp', 'analytics'],
      enabledFeatures: ['ERP_CORE'],
      isSuspended: false,
    };

    mockRedis.get.mockResolvedValue(JSON.stringify(cachedContext));

    const result = await service.getAccessContext('tenant-101', {
      userId: 'user-2',
      role: 'OWNER',
    });

    expect(mockRedis.get).toHaveBeenCalledWith('tenant:tenant-101:entitlements');
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(result.tenantId).toBe('tenant-101');
    expect(result.userId).toBe('user-2'); // re-hydrated
    expect(result.role).toBe('OWNER');
    expect(result.entitledServices).toContain('erp');
  });

  it('falls back to Prisma database on Redis miss and caches the result', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');

    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-202',
      plan: 'STARTER',
      status: 'ACTIVE',
    });

    mockPrisma.tenantEntitlement.findFirst.mockResolvedValue({
      id: 'ent-1',
      tenantId: 'tenant-202',
      planId: 'plan-starter',
      effectiveAt: new Date('2026-01-01'),
      expiresAt: null,
      plan: {
        id: 'plan-starter',
        tier: 'PRO',
        features: [
          { featureKey: 'ERP_CORE', enabled: true },
          { featureKey: 'FINANCIAL_LEDGERS', enabled: true },
        ],
      },
      addOns: [],
    });

    const result = await service.getAccessContext('tenant-202');

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-202' },
      select: { id: true, plan: true, status: true },
    });
    expect(mockRedis.set).toHaveBeenCalled();
    expect(result.planTier).toBe('PRO');
    expect(result.entitledServices).toContain('erp');
    expect(result.isSuspended).toBe(false);
  });

  it('correctly flags suspended tenant', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-susp',
      plan: 'STARTER',
      status: 'SUSPENDED',
    });
    mockPrisma.tenantEntitlement.findFirst.mockResolvedValue(null);

    const result = await service.getAccessContext('tenant-susp');
    expect(result.isSuspended).toBe(true);

    const decision = service.evaluate(result, 'erp');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('TENANT_SUSPENDED');
    expect(decision.upgradeUrl).toBe('/billing/reactivate');
  });

  it('unlocks microservices via Add-ons', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-starter-with-wms-addon',
      plan: 'STARTER',
      status: 'ACTIVE',
    });
    mockPrisma.tenantEntitlement.findFirst.mockResolvedValue({
      id: 'ent-2',
      tenantId: 'tenant-starter-with-wms-addon',
      plan: {
        tier: 'FREE',
        features: [],
      },
      addOns: [
        {
          addOn: { id: 'addon-wms', slug: 'wms' },
        },
      ],
    });

    const result = await service.getAccessContext('tenant-starter-with-wms-addon');
    expect(result.entitledServices).toContain('wms');

    const decision = service.evaluate(result, 'wms');
    expect(decision.allowed).toBe(true);
  });

  it('evaluates access and denies access when service is not entitled', async () => {
    const context = {
      tenantId: 'tenant-starter',
      userId: 'user-1',
      role: 'MEMBER' as const,
      planTier: 'STARTER' as const,
      entitledServices: ['core', 'workspace', 'hrm', 'crm'] as any[],
      enabledFeatures: [],
      isSuspended: false,
    };

    const decision = service.evaluate(context, 'erp');
    expect(decision.allowed).toBe(false);
    expect(decision.serviceId).toBe('erp');
    expect(decision.reason).toBe('SERVICE_NOT_ENTITLED');
    expect(decision.requiredFeatures).toEqual(['ERP_CORE', 'FINANCIAL_LEDGERS', 'module.erp']);
    expect(decision.upgradeUrl).toBe('/admin/plans?highlight=erp');
  });

  it('invalidates cache via Redis del and publish', async () => {
    await service.invalidate('tenant-101');
    expect(mockRedis.del).toHaveBeenCalledWith('tenant:tenant-101:entitlements');
    expect(mockRedis.publish).toHaveBeenCalledWith('tenant:entitlements:invalidated', 'tenant-101');
  });
});
