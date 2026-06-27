import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class EndpointSecurityService extends TenantScopedService {
  async listDevices() {
    return this.prisma.device.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async enrollDevice(data: any) {
    return this.prisma.device.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listThreats(status?: string) {
    return this.prisma.threatEvent.findMany({
      where: { tenantId: this.getTenantId(), ...(status && { status }) },
      orderBy: { detectedAt: 'desc' },
    });
  }

  async reportThreat(data: any) {
    return this.prisma.threatEvent.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async resolveThreat(id: string) {
    return this.prisma.threatEvent.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }
}