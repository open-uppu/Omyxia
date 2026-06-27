import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class FiscalPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async list() {
    return this.prisma.fiscalPeriod.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(data: { startDate: Date; endDate: Date }) {
    return this.prisma.fiscalPeriod.create({
      data: { ...data, tenantId: this.getTenantId(), status: 'OPEN' },
    });
  }

  async close(id: string, userId: string) {
    return this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date(), closedBy: userId },
    });
  }
}