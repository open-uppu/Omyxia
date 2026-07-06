import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntitlementsService } from './entitlements.service';
import { mkPrismaStub, mkRedisStub } from './__fixtures__';

/**
 * EntitlementsService — cache + DB fallback.
 *
 * No HTTP, no Redis — we stub the collaborators so these tests run
 * in <50ms and don't need a Nest TestBed.
 */

describe('EntitlementsService', () => {
  let prisma: any;
  let redis: ReturnType<typeof mkRedisStub>;
  let service: EntitlementsService;

  beforeEach(() => {
    prisma = mkPrismaStub();
    redis = mkRedisStub();
    service = new EntitlementsService(prisma, redis as any);
  });

  it('returns a deny-all sentinel when no entitlement record exists', async () => {
    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => null,
      },
    });
    service = new EntitlementsService(prisma, redis as any);

    const out = await service.forTenant('tenant-x');
    expect(out.tenantId).toBe('tenant-x');
    expect(out.planTier).toBeNull();
    expect(out.features).toEqual({});
    expect(out.limits).toEqual({});
  });

  it('returns deny-all when tenantId is missing', async () => {
    const out = await service.forTenant('');
    expect(out.tenantId).toBe('');
    expect(out.features).toEqual({});
  });

  it('serves from the Redis cache when populated', async () => {
    const cached = {
      tenantId: 'tenant-1',
      planTier: 'PRO',
      planId: 'plan-pro',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      features: { 'module.crm': true },
      limits: { 'limit.maxEmployees': 25 },
      addOns: [],
      generatedAt: new Date().toISOString(),
    };
    redis._store.set('entitlements:v1:tenant-1', JSON.stringify(cached));

    const out = await service.forTenant('tenant-1');
    expect(out.planTier).toBe('PRO');
    expect(out.features['module.crm']).toBe(true);
    expect(out.limits['limit.maxEmployees']).toBe(25);
  });

  it('drops a corrupt cache entry and re-reads from DB', async () => {
    redis._store.set('entitlements:v1:tenant-1', '{not-json');

    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => ({
          effectiveAt: new Date('2026-01-01'),
          expiresAt: null,
          planId: 'plan-pro',
          plan: {
            tier: 'PRO',
            features: [
              { featureKey: 'module.crm', enabled: true, limit: null },
              { featureKey: 'limit.maxEmployees', enabled: true, limit: 25 },
            ],
          },
          addOns: [],
        }),
      },
    });
    service = new EntitlementsService(prisma, redis as any);

    const out = await service.forTenant('tenant-1');
    expect(out.planTier).toBe('PRO');
    expect(out.features['module.crm']).toBe(true);
    expect(out.limits['limit.maxEmployees']).toBe(25);
  });

  it('reads from DB and writes through to cache when cache miss', async () => {
    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => ({
          effectiveAt: new Date('2026-01-01'),
          expiresAt: null,
          planId: 'plan-pro',
          plan: {
            tier: 'PRO',
            features: [
              { featureKey: 'module.crm', enabled: true, limit: null },
            ],
          },
          addOns: [],
        }),
      },
    });
    service = new EntitlementsService(prisma, redis as any);

    const out = await service.forTenant('tenant-1');
    expect(out.features['module.crm']).toBe(true);
    // Cache should now contain the payload.
    const cachedRaw = await redis.get('entitlements:v1:tenant-1');
    expect(cachedRaw).toBeTruthy();
    const cached = JSON.parse(cachedRaw as string);
    expect(cached.features['module.crm']).toBe(true);
  });

  it('ignores expired entitlements and returns deny-all', async () => {
    // findFirst filtered at DB level, but our stub ignores filters —
    // emulate by returning null for expired.
    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => null,
      },
    });
    service = new EntitlementsService(prisma, redis as any);

    const out = await service.forTenant('tenant-expired');
    expect(out.features).toEqual({});
  });

  it('handles Redis errors on read by falling back to DB', async () => {
    const brokenRedis = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn(),
      del: vi.fn(),
      publish: vi.fn(),
    };
    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => ({
          effectiveAt: new Date('2026-01-01'),
          expiresAt: null,
          planId: 'plan-pro',
          plan: {
            tier: 'PRO',
            features: [
              { featureKey: 'module.crm', enabled: true, limit: null },
            ],
          },
          addOns: [],
        }),
      },
    });
    const svc = new EntitlementsService(prisma, brokenRedis as any);

    const out = await svc.forTenant('tenant-1');
    expect(out.features['module.crm']).toBe(true);
    // Should also try to write to cache (will fail silently).
    expect(brokenRedis.set).toHaveBeenCalled();
  });

  it('handles DB errors by returning deny-all', async () => {
    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => {
          throw new Error('db down');
        },
      },
    });
    const svc = new EntitlementsService(prisma, redis as any);

    const out = await svc.forTenant('tenant-x');
    expect(out.features).toEqual({});
    expect(out.planTier).toBeNull();
  });

  it('invalidate() removes the cache entry + publishes invalidation', async () => {
    redis._store.set('entitlements:v1:tenant-1', '{}');
    const publishSpy = vi.spyOn(redis, 'publish');

    await service.invalidate('tenant-1');
    expect(redis._store.has('entitlements:v1:tenant-1')).toBe(false);
    expect(publishSpy).toHaveBeenCalledWith('entitlements:invalidated', 'tenant-1');
  });

  it('applies LEGACY_FULL_ACCESS tier to enable every known module', async () => {
    prisma = mkPrismaStub({
      tenantEntitlement: {
        findFirst: async () => ({
          effectiveAt: new Date('2026-01-01'),
          expiresAt: null,
          planId: 'plan-legacy',
          plan: {
            tier: 'LEGACY_FULL_ACCESS',
            features: [],
          },
          addOns: [],
        }),
      },
    });
    service = new EntitlementsService(prisma, redis as any);

    const out = await service.forTenant('tenant-legacy');
    expect(out.planTier).toBe('LEGACY_FULL_ACCESS');
    expect(out.features['module.crm']).toBe(true);
    expect(out.features['module.bi']).toBe(true);
    expect(out.features['module.wms']).toBe(true);
  });
});
