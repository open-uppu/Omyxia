import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionsService } from './positions.service';

describe('PositionsService', () => {
  let service: PositionsService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      position: {
        findMany: vi.fn().mockResolvedValue([{ id: 'position-1' }]),
        create: vi.fn().mockResolvedValue({ id: 'position-2' }),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new PositionsService(prisma, tenantContext);
  });

  it('should list positions for the tenant', async () => {
    const result = await service.list();

    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(result).toEqual([{ id: 'position-1' }]);
  });

  it('should create a position for the tenant', async () => {
    const data = { name: 'Engineering Manager', code: 'ENG-MGR' };

    const result = await service.create(data);

    expect(prisma.position.create).toHaveBeenCalledWith({
      data: { ...data, tenantId: 'tenant-1' },
    });
    expect(result).toEqual({ id: 'position-2' });
  });

  it('should throw when there is no tenant context', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);

    await expect(service.list()).rejects.toThrow('No tenant context');
    expect(prisma.position.findMany).not.toHaveBeenCalled();
  });
});
