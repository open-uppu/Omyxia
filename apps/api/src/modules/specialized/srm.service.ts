import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class SrmService extends TenantScopedService {
  async scoreVendor(vendorId: string, periodStart: Date, periodEnd: Date, scores: any) {
    const total = (scores.onTime + scores.quality + scores.price) / 3;
    return this.prisma.supplierScore.create({
      data: {
        tenantId: this.getTenantId(),
        vendorId,
        periodStart,
        periodEnd,
        onTimeDeliveryRate: scores.onTime,
        qualityScore: scores.quality,
        priceCompetitiveness: scores.price,
        totalScore: total,
      },
    });
  }

  async getVendorScores(vendorId: string) {
    return this.prisma.supplierScore.findMany({
      where: { tenantId: this.getTenantId(), vendorId },
      orderBy: { periodEnd: 'desc' },
    });
  }
}