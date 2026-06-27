import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listRates() {
    return this.prisma.taxRate.findMany({
      where: { tenantId: this.getTenantId() },
    });
  }

  async createRate(data: any) {
    return this.prisma.taxRate.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async seedThaiDefaults() {
    const defaults = [
      { type: 'VAT', name: 'Thai VAT', rate: 7.00, effectiveFrom: new Date('2024-01-01') },
      { type: 'WHT_1', name: 'WHT Transport 1%', rate: 1.00, effectiveFrom: new Date('2024-01-01') },
      { type: 'WHT_2', name: 'WHT Services 2%', rate: 2.00, effectiveFrom: new Date('2024-01-01') },
      { type: 'WHT_3', name: 'WHT Rent 3%', rate: 3.00, effectiveFrom: new Date('2024-01-01') },
      { type: 'WHT_5', name: 'WHT Professional 5%', rate: 5.00, effectiveFrom: new Date('2024-01-01') },
    ];
    for (const rate of defaults) {
      await this.prisma.taxRate.create({
        data: { ...rate, tenantId: this.getTenantId() },
      }).catch(() => null); // skip duplicates
    }
    return { count: defaults.length };
  }

  async pp30Report(periodStart: Date, periodEnd: Date) {
    const outputVat = await this.prisma.taxTransaction.findMany({
      where: {
        tenantId: this.getTenantId(),
        sourceType: 'INVOICE',
        taxRate: { type: 'OUTPUT_VAT' },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });
    const inputVat = await this.prisma.taxTransaction.findMany({
      where: {
        tenantId: this.getTenantId(),
        sourceType: 'BILL',
        taxRate: { type: 'INPUT_VAT' },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });
    const totalOutput = outputVat.reduce((sum, t) => sum + Number(t.taxAmount), 0);
    const totalInput = inputVat.reduce((sum, t) => sum + Number(t.taxAmount), 0);
    return {
      periodStart,
      periodEnd,
      outputVat: totalOutput,
      inputVat: totalInput,
      netPayable: totalOutput - totalInput,
    };
  }
}