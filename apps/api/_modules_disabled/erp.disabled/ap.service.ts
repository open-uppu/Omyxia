import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class ApService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listVendors() {
    return this.prisma.vendor.findMany({
      where: { tenantId: this.getTenantId() },
    });
  }

  async createVendor(data: any) {
    return this.prisma.vendor.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listBills(status?: string) {
    return this.prisma.apBill.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(status && { status: status as any }),
      },
      include: { vendor: true },
      orderBy: { dueDate: 'asc' },
    });
  }

  async createBill(data: any) {
    const subtotal = Number(data.subtotal || 0);
    const taxAmount = subtotal * 0.07; // VAT
    const whtRate = data.whtRate || 0.03; // Default 3% WHT
    const whtAmount = subtotal * whtRate;
    const total = subtotal + taxAmount - whtAmount;
    const billNo = `BILL-${Date.now()}`;
    return this.prisma.apBill.create({
      data: {
        tenantId: this.getTenantId(),
        vendorId: data.vendorId,
        billNo,
        billDate: new Date(data.billDate),
        dueDate: new Date(data.dueDate),
        subtotal,
        taxAmount,
        whtAmount,
        total,
        status: 'DRAFT',
      },
    });
  }

  async aging() {
    const bills = await this.prisma.apBill.findMany({
      where: { tenantId: this.getTenantId(), status: { in: ['APPROVED', 'PARTIAL', 'OVERDUE'] } },
    });
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const now = Date.now();
    for (const bill of bills) {
      const days = Math.floor((now - bill.dueDate.getTime()) / 86400000);
      const outstanding = Number(bill.total) - Number(bill.paidAmount);
      if (days <= 30) buckets['0-30'] += outstanding;
      else if (days <= 60) buckets['31-60'] += outstanding;
      else if (days <= 90) buckets['61-90'] += outstanding;
      else buckets['90+'] += outstanding;
    }
    return buckets;
  }
}