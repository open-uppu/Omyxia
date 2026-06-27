import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listPipelines() {
    return this.prisma.crmPipeline.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createPipeline(data: { name: string; stages: string[] }) {
    return this.prisma.crmPipeline.create({
      data: { ...data, stages: data.stages, tenantId: this.getTenantId() },
    });
  }

  async listLeads(stage?: string, status?: string) {
    return this.prisma.crmLead.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(stage && { stage }),
        ...(status && { status: status as any }),
      },
      include: { customer: true, owner: true },
    });
  }

  async createLead(data: any) {
    return this.prisma.crmLead.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async updateLeadStage(id: string, stage: string) {
    return this.prisma.crmLead.update({ where: { id }, data: { stage } });
  }

  async deleteLead(id: string) {
    return this.prisma.crmLead.delete({ where: { id } });
  }

  async listActivities(leadId?: string) {
    return this.prisma.crmActivity.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(leadId && { leadId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createActivity(data: any) {
    return this.prisma.crmActivity.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }
}
