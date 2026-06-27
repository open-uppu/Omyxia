import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PayrollService } from './payroll.service';

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      payrollPeriod: {
        findMany: vi.fn().mockResolvedValue([{ id: 'period-1' }]),
        findFirst: vi.fn().mockResolvedValue({ id: 'period-1' }),
        create: vi.fn().mockResolvedValue({ id: 'period-2' }),
        update: vi.fn().mockResolvedValue({ id: 'period-1' }),
      },
      employee: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'emp-1', baseSalary: 30000 },
          { id: 'emp-2', baseSalary: 20000 },
        ]),
      },
      payrollLine: {
        create: vi.fn().mockResolvedValue({ id: 'line-1' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'line-1' }]),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new PayrollService(prisma, tenantContext);
  });

  it('should list payroll periods for the tenant', async () => {
    const result = await service.listPeriods();

    expect(prisma.payrollPeriod.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      orderBy: { periodStart: 'desc' },
    });
    expect(result).toEqual([{ id: 'period-1' }]);
  });

  it('should create a draft payroll period', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z');
    const periodEnd = new Date('2026-06-30T00:00:00.000Z');

    const result = await service.createPeriod(periodStart, periodEnd);

    expect(prisma.payrollPeriod.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', periodStart, periodEnd, status: 'DRAFT' },
    });
    expect(result).toEqual({ id: 'period-2' });
  });

  it('should throw when getTenantId has no tenant context', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);

    await expect(service.listPeriods()).rejects.toThrow('No tenant context');
  });

  describe('calculate', () => {
    it('should throw when the period is not found', async () => {
      prisma.payrollPeriod.findFirst.mockResolvedValue(null);

      await expect(service.calculate('period-1')).rejects.toThrow('Period not found');
      expect(prisma.payrollPeriod.findFirst).toHaveBeenCalledWith({
        where: { id: 'period-1', tenantId: 'tenant-1' },
      });
      expect(prisma.payrollLine.create).not.toHaveBeenCalled();
    });

    it('should create a payroll line per active employee with computed amounts', async () => {
      const result = await service.calculate('period-1');

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'ACTIVE' },
      });
      expect(prisma.payrollLine.create).toHaveBeenCalledTimes(2);

      // emp-1: baseSalary 30000, tax 5% = 1500, SS min(1500, 750) = 750, net = 27750
      expect(prisma.payrollLine.create).toHaveBeenNthCalledWith(1, {
        data: {
          tenantId: 'tenant-1',
          periodId: 'period-1',
          employeeId: 'emp-1',
          baseSalary: 30000,
          tax: 1500,
          socialSecurity: 750,
          netPay: 27750,
        },
      });

      // emp-2: baseSalary 20000, tax 5% = 1000, SS min(1000, 750) = 750, net = 18250
      expect(prisma.payrollLine.create).toHaveBeenNthCalledWith(2, {
        data: {
          tenantId: 'tenant-1',
          periodId: 'period-1',
          employeeId: 'emp-2',
          baseSalary: 20000,
          tax: 1000,
          socialSecurity: 750,
          netPay: 18250,
        },
      });

      expect(result).toEqual({ count: 2 });
    });

    it('should default missing baseSalary to zero', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-3', baseSalary: null }]);

      const result = await service.calculate('period-1');

      expect(prisma.payrollLine.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          periodId: 'period-1',
          employeeId: 'emp-3',
          baseSalary: 0,
          tax: 0,
          socialSecurity: 0,
          netPay: 0,
        },
      });
      expect(result).toEqual({ count: 1 });
    });
  });

  it('should approve a payroll period', async () => {
    const result = await service.approve('period-1', 'manager-1');

    expect(prisma.payrollPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { status: 'APPROVED', approvedBy: 'manager-1', approvedAt: expect.any(Date) },
    });
    expect(result).toEqual({ id: 'period-1' });
  });

  it('should list payroll lines for a period including the employee', async () => {
    const result = await service.listLines('period-1');

    expect(prisma.payrollLine.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', periodId: 'period-1' },
      include: { employee: true },
    });
    expect(result).toEqual([{ id: 'line-1' }]);
  });
});
