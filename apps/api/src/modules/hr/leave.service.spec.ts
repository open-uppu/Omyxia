import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaveService } from './leave.service';

describe('LeaveService', () => {
  let service: LeaveService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      leaveRequest: {
        findMany: vi.fn().mockResolvedValue([{ id: 'leave-1' }]),
        create: vi.fn().mockResolvedValue({ id: 'leave-2' }),
        update: vi.fn().mockResolvedValue({ id: 'leave-1' }),
      },
      leaveQuota: {
        findMany: vi.fn().mockResolvedValue([{ id: 'quota-1' }]),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new LeaveService(prisma, tenantContext);
  });

  it('should list leave requests', async () => {
    const result = await service.list('emp-1', 'PENDING');

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', employeeId: 'emp-1', status: 'PENDING' },
      orderBy: { startDate: 'desc' },
    });
    expect(result).toEqual([{ id: 'leave-1' }]);
  });

  it('should create a pending leave request with calculated days', async () => {
    const data = {
      employeeId: 'emp-1',
      leaveType: 'ANNUAL',
      startDate: new Date('2026-02-10T00:00:00.000Z'),
      endDate: new Date('2026-02-12T00:00:00.000Z'),
      reason: 'Vacation',
    };

    const result = await service.create(data);

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        leaveType: 'ANNUAL',
        startDate: data.startDate,
        endDate: data.endDate,
        days: 3,
        reason: 'Vacation',
        status: 'PENDING',
      },
    });
    expect(result).toEqual({ id: 'leave-2' });
  });

  it('should approve a leave request', async () => {
    const result = await service.approve('leave-1', 'manager-1');

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'leave-1' },
      data: { status: 'APPROVED', approverId: 'manager-1', approvedAt: expect.any(Date) },
    });
    expect(result).toEqual({ id: 'leave-1' });
  });

  it('should reject a leave request', async () => {
    const result = await service.reject('leave-1', 'manager-1');

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'leave-1' },
      data: { status: 'REJECTED', approverId: 'manager-1', approvedAt: expect.any(Date) },
    });
    expect(result).toEqual({ id: 'leave-1' });
  });

  it('should get leave quota for an employee and year', async () => {
    const result = await service.getQuota('emp-1', 2026);

    expect(prisma.leaveQuota.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', employeeId: 'emp-1', year: 2026 },
    });
    expect(result).toEqual([{ id: 'quota-1' }]);
  });
});
