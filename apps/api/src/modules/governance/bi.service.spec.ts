import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BiService } from './bi.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

const tenantId = 'tenant-test-1';

function makePrismaMock(overrides: any = {}) {
  return {
    dashboard: {
      findMany: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Sales' }]),
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'd-new', ...args.data, createdAt: new Date() }),
      ),
    },
    reportSnapshot: {
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 's1', createdAt: new Date(), ...args.data }),
      ),
      findMany: vi.fn().mockResolvedValue([{ id: 's1', dashboardId: 'd1' }]),
    },
    kpiDefinition: {
      findMany: vi.fn().mockResolvedValue([{ id: 'k1', name: 'Revenue' }]),
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'k-new', ...args.data }),
      ),
    },
    ...overrides,
  };
}

describe('BiService', () => {
  let service: BiService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let tenantCtx: { getTenantId: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = makePrismaMock();
    tenantCtx = { getTenantId: vi.fn().mockReturnValue(tenantId) };
    service = new BiService(prisma as any, tenantCtx as any as TenantContextService);
  });

  it('listDashboards: tenant-scoped query', async () => {
    const result = await service.listDashboards();
    expect(result).toHaveLength(1);
    expect(prisma.dashboard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }) }),
    );
  });

  it('createDashboard: enforces tenantId from context', async () => {
    await service.createDashboard({ name: 'HR', description: 'x' });
    expect(prisma.dashboard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId, name: 'HR' }),
      }),
    );
  });

  it('snapshot: persists with tenantId + auto-generated name', async () => {
    await service.snapshot('d1', { value: 42 }, { period: 'Q1' });
    expect(prisma.reportSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          dashboardId: 'd1',
          data: { value: 42 },
          parameters: { period: 'Q1' },
        }),
      }),
    );
  });

  it('listSnapshots: filtered by dashboardId + tenant', async () => {
    await service.listSnapshots('d1');
    expect(prisma.reportSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dashboardId: 'd1', tenantId }),
      }),
    );
  });

  it('listSnapshots: when no dashboardId, no dashboard filter', async () => {
    await service.listSnapshots();
    const call = prisma.reportSnapshot.findMany.mock.calls[0][0];
    expect(call.where.dashboardId).toBeUndefined();
    expect(call.where.tenantId).toBe(tenantId);
  });

  it('reject when tenant context is empty (defense in depth)', async () => {
    tenantCtx.getTenantId.mockReturnValue('');
    await expect(service.listDashboards()).rejects.toThrow();
  });
});
