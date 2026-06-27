import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async list(employeeId?: string, from?: Date, to?: Date) {
    return this.prisma.attendanceRecord.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(employeeId && { employeeId }),
        ...(from && to && { date: { gte: from, lte: to } }),
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async clockIn(employeeId: string) {
    return this.prisma.attendanceRecord.upsert({
      where: {
        tenantId_employeeId_date: {
          tenantId: this.getTenantId(),
          employeeId,
          date: new Date(),
        },
      },
      create: {
        tenantId: this.getTenantId(),
        employeeId,
        date: new Date(),
        clockIn: new Date(),
        status: 'PRESENT',
      },
      update: { clockIn: new Date() },
    });
  }

  async clockOut(employeeId: string) {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId: this.getTenantId(),
          employeeId,
          date: new Date(),
        },
      },
    });
    if (!record) throw new Error('No clock-in record today');
    const now = new Date();
    const hours = (now.getTime() - record.clockIn!.getTime()) / 3600000;
    return this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { clockOut: now, hoursWorked: hours },
    });
  }
}