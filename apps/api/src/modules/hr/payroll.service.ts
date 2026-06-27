import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listPeriods() {
    return this.prisma.payrollPeriod.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { periodStart: 'desc' },
    });
  }

  async createPeriod(periodStart: Date, periodEnd: Date) {
    return this.prisma.payrollPeriod.create({
      data: { tenantId: this.getTenantId(), periodStart, periodEnd, status: 'DRAFT' },
    });
  }

  async calculate(periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: periodId, tenantId: this.getTenantId() },
    });
    if (!period) throw new Error('Period not found');
    const employees = await this.prisma.employee.findMany({
      where: { tenantId: this.getTenantId(), status: 'ACTIVE' },
    });
    const lines = employees.map((emp) => {
      const baseSalary = Number(emp.baseSalary ?? 0);
      const tax = baseSalary * 0.05; // simplified 5%
      const socialSecurity = Math.min(baseSalary * 0.05, 750);
      const netPay = baseSalary - tax - socialSecurity;
      return {
        tenantId: this.getTenantId(),
        periodId,
        employeeId: emp.id,
        baseSalary,
        tax,
        socialSecurity,
        netPay,
      };
    });
    for (const line of lines) {
      await this.prisma.payrollLine.create({ data: line });
    }
    return { count: lines.length };
  }

  async approve(periodId: string, approverId: string) {
    return this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: { status: 'APPROVED', approvedBy: approverId, approvedAt: new Date() },
    });
  }

  async listLines(periodId: string) {
    return this.prisma.payrollLine.findMany({
      where: { tenantId: this.getTenantId(), periodId },
      include: { employee: true },
    });
  }
}