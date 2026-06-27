import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getCurrent() {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) throw new Error('No tenant context');
    return this.prisma.tenant.findUnique({ where: { id: tenantId } });
  }

  async updateCurrent(data: { name?: string; settings?: any }) {
    const tenantId = this.tenantContext.getTenantId();
    return this.prisma.tenant.update({ where: { id: tenantId }, data });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.userTenant.findMany({
      where: { userId },
      include: { tenant: true },
    });
    return memberships.map((m) => ({ ...m.tenant, role: m.role }));
  }
}