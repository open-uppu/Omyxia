import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class MasService extends TenantScopedService {
  async listCampaigns() {
    return this.prisma.marketingCampaign.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCampaign(data: any) {
    return this.prisma.marketingCampaign.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async sendCampaign(id: string) {
    return this.prisma.marketingCampaign.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  async listProfiles() {
    return this.prisma.customerProfile.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { lifetimeValue: 'desc' },
      take: 100,
    });
  }

  async trackEvent(profileId: string, type: string, properties: any = {}) {
    return this.prisma.customerEvent.create({
      data: { tenantId: this.getTenantId(), profileId, type, properties },
    });
  }
}