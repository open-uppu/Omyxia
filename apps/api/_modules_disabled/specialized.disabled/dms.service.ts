import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class DmsService extends TenantScopedService {
  async listTemplates() {
    return this.prisma.documentTemplate.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createTemplate(data: any) {
    return this.prisma.documentTemplate.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listInstances() {
    return this.prisma.documentInstance.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createInstance(data: any) {
    return this.prisma.documentInstance.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async sign(id: string, userId: string) {
    return this.prisma.documentInstance.update({
      where: { id },
      data: { status: 'SIGNED', signedBy: userId, signedAt: new Date() },
    });
  }
}