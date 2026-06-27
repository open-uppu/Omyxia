import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class FrmService extends TenantScopedService {
  async listCreditAssessments() {
    return this.prisma.creditAssessment.findMany({
      where: { tenantId: this.getTenantId() },
    });
  }

  async assessParty(partyType: string, partyId: string, creditLimit: number) {
    return this.prisma.creditAssessment.create({
      data: { tenantId: this.getTenantId(), partyType, partyId, creditLimit },
    });
  }

  async cashFlowForecast(from: Date, to: Date) {
    return this.prisma.cashFlowForecast.findMany({
      where: { tenantId: this.getTenantId(), periodStart: { gte: from, lte: to } },
    });
  }

  async listFraudAlerts() {
    return this.prisma.fraudAlert.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }
}