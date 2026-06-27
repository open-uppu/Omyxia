import { Injectable } from '@nestjs/common';
import { TenantScopedService } from '../specialized/base.service';

@Injectable()
export class CmpService extends TenantScopedService {
  async listConsents(subjectId?: string) {
    return this.prisma.consentRecord.findMany({
      where: { tenantId: this.getTenantId(), ...(subjectId && { subjectId }) },
      orderBy: { grantedAt: 'desc' },
    });
  }

  async recordConsent(data: any) {
    return this.prisma.consentRecord.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async withdrawConsent(id: string) {
    return this.prisma.consentRecord.update({
      where: { id },
      data: { withdrawnAt: new Date() },
    });
  }

  async listDSRs(status?: string) {
    return this.prisma.dataSubjectRequest.findMany({
      where: { tenantId: this.getTenantId(), ...(status && { status }) },
    });
  }

  async createDSR(data: any) {
    const dueAt = new Date(Date.now() + 30 * 24 * 3600000); // 30 days SLA
    return this.prisma.dataSubjectRequest.create({
      data: { ...data, tenantId: this.getTenantId(), dueAt },
    });
  }

  async completeDSR(id: string) {
    return this.prisma.dataSubjectRequest.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  async recordCookieConsent(visitorId: string, categories: string[]) {
    return this.prisma.cookieConsent.create({
      data: {
        tenantId: this.getTenantId(),
        visitorId,
        categories,
        expiresAt: new Date(Date.now() + 365 * 24 * 3600000), // 1 year
      },
    });
  }

  async reportBreach(data: any) {
    return this.prisma.dataBreachIncident.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }
}