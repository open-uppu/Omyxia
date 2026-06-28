import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmService } from './crm.service';

describe('CrmService', () => {
  let service: CrmService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      crmLead: {
        findMany: vi.fn().mockResolvedValue([{ id: 'lead-1', name: 'Acme' }]),
        create: vi.fn().mockResolvedValue({ id: 'lead-2', name: 'Globex' }),
        update: vi.fn().mockResolvedValue({ id: 'lead-1', stage: 'QUALIFIED' }),
        delete: vi.fn().mockResolvedValue({ id: 'lead-1' }),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new CrmService(prisma, tenantContext);
  });

  it('should list leads for the tenant', async () => {
    const result = await service.listLeads();

    expect(prisma.crmLead.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      include: { Customer: true, User: true },
    });
    expect(result).toEqual([{ id: 'lead-1', name: 'Acme' }]);
  });

  it('should filter listed leads by stage and status', async () => {
    await service.listLeads('QUALIFIED', 'OPEN');

    expect(prisma.crmLead.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', stage: 'QUALIFIED', status: 'OPEN' },
      include: { Customer: true, User: true },
    });
  });

  it('should create a lead for the tenant', async () => {
    const data = {
      pipelineId: 'pipeline-1',
      name: 'Globex',
      contactEmail: 'buyer@example.com',
      stage: 'NEW',
    };

    const result = await service.createLead(data);

    expect(prisma.crmLead.create).toHaveBeenCalledWith({
      data: { ...data, tenantId: 'tenant-1' },
    });
    expect(result).toEqual({ id: 'lead-2', name: 'Globex' });
  });

  it('should update a lead stage', async () => {
    const result = await service.updateLeadStage('lead-1', 'QUALIFIED');

    expect(prisma.crmLead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { stage: 'QUALIFIED' },
    });
    expect(result).toEqual({ id: 'lead-1', stage: 'QUALIFIED' });
  });

  it('should delete a lead', async () => {
    const result = await service.deleteLead('lead-1');

    expect(prisma.crmLead.delete).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
    });
    expect(result).toEqual({ id: 'lead-1' });
  });
});
