import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      attendanceRecord: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: '1' }),
        findUnique: vi.fn().mockResolvedValue({ id: '1', clockIn: new Date() }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new AttendanceService(prisma, tenantContext);
  });

  it('should list attendance records', async () => {
    await service.list();
    expect(prisma.attendanceRecord.findMany).toHaveBeenCalled();
  });

  it('should clock in', async () => {
    await service.clockIn('emp-1');
    expect(prisma.attendanceRecord.upsert).toHaveBeenCalled();
  });

  it('should throw if no clock-in record when clocking out', async () => {
    prisma.attendanceRecord.findUnique.mockResolvedValue(null);
    await expect(service.clockOut('emp-1')).rejects.toThrow('No clock-in record today');
  });

  it('should clock out', async () => {
    prisma.attendanceRecord.findUnique.mockResolvedValue({
      id: '1',
      clockIn: new Date(Date.now() - 3600000),
    });
    await service.clockOut('emp-1');
    expect(prisma.attendanceRecord.update).toHaveBeenCalled();
  });
});