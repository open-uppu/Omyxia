import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class PositionsService {
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
    return this.prisma.position.findMany({
      where: { tenantId: this.getTenantId() },
    });
  }

  async create(data: any) {
    return this.prisma.position.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }
}