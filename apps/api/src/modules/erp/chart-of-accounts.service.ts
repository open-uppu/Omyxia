import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async list(type?: string) {
    return this.prisma.chartOfAccounts.findMany({
      where: { tenantId: this.getTenantId(), ...(type && { type: type as any }) },
      orderBy: { code: 'asc' },
    });
  }

  async get(id: string) {
    return this.prisma.chartOfAccounts.findFirst({
      where: { id, tenantId: this.getTenantId() },
    });
  }

  async create(data: any) {
    return this.prisma.chartOfAccounts.create({
      data: { ...data, tenantId: this.getTenantId() },
    });
  }

  async seedThaiChart() {
    const accounts = [
      { code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT' },
      { code: '1100', name: 'Bank', type: 'ASSET', normalBalance: 'DEBIT' },
      { code: '1200', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT' },
      { code: '1300', name: 'Inventory', type: 'ASSET', normalBalance: 'DEBIT' },
      { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
      { code: '2100', name: 'VAT Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
      { code: '2200', name: 'WHT Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
      { code: '3000', name: 'Owner Equity', type: 'EQUITY', normalBalance: 'CREDIT' },
      { code: '4000', name: 'Sales Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
      { code: '4100', name: 'Service Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
      { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', normalBalance: 'DEBIT' },
      { code: '6000', name: 'Salaries Expense', type: 'EXPENSE', normalBalance: 'DEBIT' },
      { code: '6100', name: 'Rent Expense', type: 'EXPENSE', normalBalance: 'DEBIT' },
    ];
    for (const acc of accounts) {
      await this.prisma.chartOfAccounts.upsert({
        where: { tenantId_code: { tenantId: this.getTenantId(), code: acc.code } },
        create: { ...acc, tenantId: this.getTenantId() },
        update: {},
      });
    }
    return { count: accounts.length };
  }
}