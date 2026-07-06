import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageLookupService } from './usage-lookup.service';

describe('UsageLookupService', () => {
  let prisma: any;
  let svc: UsageLookupService;

  beforeEach(() => {
    prisma = {
      employee: { count: vi.fn().mockResolvedValue(7) },
      crmLead: { count: vi.fn().mockResolvedValue(13) },
      userTenant: { count: vi.fn().mockResolvedValue(4) },
      project: { count: vi.fn().mockResolvedValue(2) },
      ticket: { count: vi.fn().mockResolvedValue(0) },
    };
    svc = new UsageLookupService(prisma);
  });

  it('counts active employees', async () => {
    const n = await svc.count('tenant-1', 'limit.maxEmployees');
    expect(n).toBe(7);
    expect(prisma.employee.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });

  it('counts CRM leads excluding WON/LOST', async () => {
    const n = await svc.count('tenant-1', 'limit.maxLeads');
    expect(n).toBe(13);
    expect(prisma.crmLead.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        status: { notIn: ['WON', 'LOST'] },
      },
    });
  });

  it('returns null for limits without a counter', async () => {
    expect(await svc.count('tenant-1', 'limit.maxStorageGB')).toBeNull();
    expect(await svc.count('tenant-1', 'limit.maxBackupGB')).toBeNull();
  });
});
