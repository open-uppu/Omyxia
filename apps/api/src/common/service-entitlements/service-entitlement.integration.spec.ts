import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { ServiceEntitlementGuard } from './service-entitlement.guard';
import { ServiceEntitlementService } from './service-entitlement.service';
import { RequiresService } from './requires-service.decorator';
import { TenantContextModule } from '../tenant-context/tenant-context.module';
import { TenantContextService } from '../tenant-context/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ServiceEntitlementHeaderSchema } from '@omyxia/shared-types';

@Controller('api/v1/erp')
@RequiresService('erp')
class MockErpController {
  @Get('journals')
  getJournals() {
    return { ok: true, data: ['journal-1', 'journal-2'] };
  }
}

@Controller('api/v1/crm')
@RequiresService('crm')
class MockCrmController {
  @Get('leads')
  getLeads() {
    return { ok: true, data: ['lead-1'] };
  }
}

@Controller('api/health')
class MockHealthController {
  @Get()
  getHealth() {
    return { status: 'healthy' };
  }
}

describe('ServiceEntitlement Integration Suite', () => {
  let app: INestApplication;
  let entitlementService: ServiceEntitlementService;

  const mockPrisma = {
    tenant: {
      findUnique: async ({ where }: any) => {
        if (where.id === 'tenant-starter') {
          return { id: 'tenant-starter', plan: 'STARTER', status: 'ACTIVE' };
        }
        if (where.id === 'tenant-pro') {
          return { id: 'tenant-pro', plan: 'GROWTH', status: 'ACTIVE' };
        }
        if (where.id === 'tenant-suspended') {
          return { id: 'tenant-suspended', plan: 'ENTERPRISE', status: 'SUSPENDED' };
        }
        return null;
      },
    },
    tenantEntitlement: {
      findFirst: async ({ where }: any) => {
        if (where.tenantId === 'tenant-starter') {
          return {
            id: 'ent-starter',
            tenantId: 'tenant-starter',
            plan: {
              tier: 'FREE',
              features: [
                { featureKey: 'HRM_CORE', enabled: true },
                { featureKey: 'CRM_CORE', enabled: true },
              ],
            },
            addOns: [],
          };
        }
        if (where.tenantId === 'tenant-pro') {
          return {
            id: 'ent-pro',
            tenantId: 'tenant-pro',
            plan: {
              tier: 'PRO',
              features: [
                { featureKey: 'ERP_CORE', enabled: true },
                { featureKey: 'FINANCIAL_LEDGERS', enabled: true },
              ],
            },
            addOns: [],
          };
        }
        return null;
      },
    },
  };

  const memoryCache = new Map<string, string>();
  const mockRedis = {
    get: async (key: string) => memoryCache.get(key) || null,
    set: async (key: string, val: string) => {
      memoryCache.set(key, val);
      return 'OK';
    },
    del: async (key: string) => {
      memoryCache.delete(key);
      return 1;
    },
    publish: async () => 1,
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TenantContextModule],
      controllers: [MockErpController, MockCrmController, MockHealthController],
      providers: [
        Reflector,
        {
          provide: ServiceEntitlementGuard,
          useFactory: (reflector: Reflector, svc: ServiceEntitlementService, tc: TenantContextService) =>
            new ServiceEntitlementGuard(reflector, svc, tc),
          inject: [Reflector, ServiceEntitlementService, TenantContextService],
        },
        ServiceEntitlementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    entitlementService = moduleRef.get(ServiceEntitlementService);

    // Apply guard globally to test full perimeter protection
    app.useGlobalGuards(moduleRef.get(ServiceEntitlementGuard));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /api/health passes without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy' });
  });

  it('2. Unauthenticated call to /api/v1/erp/journals returns 401 Unauthorized', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/erp/journals');
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe(401);
  });

  it('3. STARTER tenant calling /api/v1/erp/journals returns HTTP 403 Forbidden with requiredFeatures and upgradeUrl', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/erp/journals')
      .set('x-tenant-id', 'tenant-starter')
      .set('x-user-id', 'user-starter-1')
      .set('x-user-role', 'OWNER');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: "Tenant is not entitled to use the 'erp' microservice",
      serviceId: 'erp',
      tenantId: 'tenant-starter',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE', 'FINANCIAL_LEDGERS', 'module.erp'],
      requiredFeature: 'ERP_CORE',
      upgradeUrl: '/admin/plans?highlight=erp',
    });
  });

  it('4. STARTER tenant calling /api/v1/crm/leads succeeds (entitled in Starter plan)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/crm/leads')
      .set('x-tenant-id', 'tenant-starter')
      .set('x-user-id', 'user-starter-1')
      .set('x-user-role', 'OWNER');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: ['lead-1'] });

    // Injected headers test
    expect(res.headers['x-tenant-id']).toBe('tenant-starter');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('5. PRO tenant calling /api/v1/erp/journals succeeds (entitled to ERP)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/erp/journals')
      .set('x-tenant-id', 'tenant-pro')
      .set('x-user-id', 'user-pro-1')
      .set('x-user-role', 'ACCOUNTANT');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: ['journal-1', 'journal-2'] });
    expect(res.headers['x-tenant-id']).toBe('tenant-pro');
  });

  it('6. Suspended tenant is rejected with 403 and reactivation URL', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/erp/journals')
      .set('x-tenant-id', 'tenant-suspended')
      .set('x-user-id', 'user-susp-1')
      .set('x-user-role', 'OWNER');

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('TENANT_SUSPENDED');
    expect(res.body.upgradeUrl).toBe('/billing/reactivate');
  });

  it('7. SUPER_ADMIN role bypasses entitlement checks across microservices', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/erp/journals')
      .set('x-tenant-id', 'tenant-starter')
      .set('x-user-id', 'super-admin-root')
      .set('x-user-role', 'SUPER_ADMIN');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
