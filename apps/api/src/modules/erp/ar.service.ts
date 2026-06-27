import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class ArService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listCustomers() {
    return this.prisma.customer.findMany({
      where: { tenantId: this.getTenantId() },
    });
  }

  async createCustomer(data: any) {
    return this.prisma.customer.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async listInvoices(status?: string) {
    return this.prisma.arInvoice.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(status && { status: status as any }),
      },
      include: { customer: true },
      orderBy: { dueDate: 'asc' },
    });
  }

  async createInvoice(data: any) {
    const subtotal = Number(data.subtotal || 0);
    const taxRate = 0.07; // Thai VAT
    const taxAmount = subtotal * taxRate;
    const total = subtotal + taxAmount;
    const invoiceNo = `INV-${Date.now()}`;
    return this.prisma.arInvoice.create({
      data: {
        tenantId: this.getTenantId(),
        customerId: data.customerId,
        invoiceNo,
        invoiceDate: new Date(data.invoiceDate),
        dueDate: new Date(data.dueDate),
        subtotal,
        taxAmount,
        total,
        status: 'DRAFT',
      },
    });
  }

  async aging() {
    const invoices = await this.prisma.arInvoice.findMany({
      where: { tenantId: this.getTenantId(), status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } },
    });
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const now = Date.now();
    for (const inv of invoices) {
      const days = Math.floor((now - inv.dueDate.getTime()) / 86400000);
      const outstanding = Number(inv.total) - Number(inv.paidAmount);
      if (days <= 30) buckets['0-30'] += outstanding;
      else if (days <= 60) buckets['31-60'] += outstanding;
      else if (days <= 90) buckets['61-90'] += outstanding;
      else buckets['90+'] += outstanding;
    }
    return buckets;
  }
}