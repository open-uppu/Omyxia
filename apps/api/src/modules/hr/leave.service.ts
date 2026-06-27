import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async list(employeeId?: string, status?: string) {
    return this.prisma.leaveRequest.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(employeeId && { employeeId }),
        ...(status && { status: status as any }),
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(data: { employeeId: string; leaveType: any; startDate: Date; endDate: Date; reason?: string }) {
    const days = Math.ceil((data.endDate.getTime() - data.startDate.getTime()) / 86400000) + 1;
    return this.prisma.leaveRequest.create({
      data: {
        tenantId: this.getTenantId(),
        employeeId: data.employeeId,
        leaveType: data.leaveType,
        startDate: data.startDate,
        endDate: data.endDate,
        days,
        reason: data.reason,
        status: 'PENDING',
      },
    });
  }

  async approve(id: string, approverId: string) {
    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'APPROVED', approverId, approvedAt: new Date() },
    });
  }

  async reject(id: string, approverId: string) {
    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'REJECTED', approverId, approvedAt: new Date() },
    });
  }

  async getQuota(employeeId: string, year: number) {
    return this.prisma.leaveQuota.findMany({
      where: { tenantId: this.getTenantId(), employeeId, year },
    });
  }
}