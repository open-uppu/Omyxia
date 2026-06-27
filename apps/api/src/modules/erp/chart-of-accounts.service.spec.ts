import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChartOfAccountsService } from './chart-of-accounts.service';

describe('ChartOfAccountsService', () => {
  let service: ChartOfAccountsService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      chartOfAccounts: {
        findMany: vi.fn().mockResolvedValue([{ id: '1', code: '1000' }]),
        findFirst: vi.fn().mockResolvedValue({ id: '1', code: '1000' }),
        create: vi.fn().mockResolvedValue({ id: '2', code: '2000' }),
        upsert: vi.fn().mockResolvedValue({ id: '1', code: '1000' }),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new ChartOfAccountsService(prisma, tenantContext);
  });

  it('should list chart of accounts', async () => {
    const result = await service.list();
    expect(prisma.chartOfAccounts.findMany).toHaveBeenCalled();
    expect(result).toEqual([{ id: '1', code: '1000' }]);
  });

  it('should filter by type when provided', async () => {
    await service.list('ASSET');
    expect(prisma.chartOfAccounts.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', type: 'ASSET' },
      orderBy: { code: 'asc' },
    });
  });

  it('should get by id', async () => {
    const result = await service.get('1');
    expect(prisma.chartOfAccounts.findFirst).toHaveBeenCalledWith({
      where: { id: '1', tenantId: 'tenant-1' },
    });
    expect(result).toEqual({ id: '1', code: '1000' });
  });

  it('should create account', async () => {
    const data = { code: '7000', name: 'Test', type: 'EXPENSE', normalBalance: 'DEBIT' };
    await service.create(data);
    expect(prisma.chartOfAccounts.create).toHaveBeenCalledWith({
      data: { ...data, tenantId: 'tenant-1' },
    });
  });

  it('should seed thai chart', async () => {
    const result = await service.seedThaiChart();
    expect(prisma.chartOfAccounts.upsert).toHaveBeenCalledTimes(13);
    expect(result).toEqual({ count: 13 });
  });
});
