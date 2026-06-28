import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async list(params: { skip?: number; take?: number; departmentId?: string }) {
    return this.prisma.employee.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(params.departmentId && { departmentId: params.departmentId }),
      },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }

  async get(id: string) {
    return this.prisma.employee.findFirst({
      where: { id, tenantId: this.getTenantId() },
    });
  }

  async create(data: any) {
    return this.prisma.employee.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.employee.update({
      where: { id },
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async delete(id: string) {
    return this.prisma.employee.update({
      where: { id },
      data: { status: 'TERMINATED', terminationDate: new Date() },
    });
  }
}