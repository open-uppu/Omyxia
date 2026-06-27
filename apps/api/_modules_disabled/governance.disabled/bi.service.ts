import { Injectable } from '@nestjs/common';
import { TenantScopedService } from '../specialized/base.service';

@Injectable()
export class BiService extends TenantScopedService {
  async listDashboards() {
    return this.prisma.dashboard.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createDashboard(data: any) {
    return this.prisma.dashboard.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async snapshot(dashboardId: string, data: any, parameters: any = {}) {
    return this.prisma.reportSnapshot.create({
      data: {
        tenantId: this.getTenantId(),
        dashboardId,
        name: `Snapshot-${Date.now()}`,
        data,
        parameters,
      },
    });
  }

  async listSnapshots(dashboardId?: string) {
    return this.prisma.reportSnapshot.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(dashboardId && { dashboardId }),
      },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
  }

  async listKpis() {
    return this.prisma.kpiDefinition.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createKpi(data: any) {
    return this.prisma.kpiDefinition.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async recordKpiValue(kpiId: string, value: number, period?: string) {
    return this.prisma.kpiSnapshot.create({
      data: { tenantId: this.getTenantId(), kpiId, value, period },
    });
  }

  async getKpiHistory(kpiId: string, limit = 100) {
    return this.prisma.kpiSnapshot.findMany({
      where: { tenantId: this.getTenantId(), kpiId },
      orderBy: { snapshotAt: 'desc' },
      take: limit,
    });
  }
}