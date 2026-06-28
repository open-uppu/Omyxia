import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class JournalService {
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
    return this.prisma.journalEntry.findMany({
      where: { tenantId: this.getTenantId() },
      include: { lines: { include: { ChartOfAccounts: true } } },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async create(data: { date: Date; description: string; reference?: string; lines: any[] }) {
    const totalDebit = data.lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const totalCredit = data.lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(`Unbalanced: debit=${totalDebit} credit=${totalCredit}`);
    }
    const entryNo = `JE-${Date.now()}`;
    return this.prisma.journalEntry.create({
      data: {
        tenantId: this.getTenantId(),
        entryNo,
        date: data.date,
        description: data.description,
        reference: data.reference,
        status: 'POSTED',
        lines: {
          create: data.lines.map((l) => ({
            tenantId: this.getTenantId(),
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            description: l.description,
          })),
        },
      },
      include: { lines: true },
    });
  }

  async trialBalance(periodStart: Date, periodEnd: Date) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        tenantId: this.getTenantId(),
        entry: { date: { gte: periodStart, lte: periodEnd } },
      },
      include: { ChartOfAccounts: true },
    });
    const balances = new Map<string, { code: string; name: string; debit: number; credit: number }>();
    for (const line of lines as any[]) {
      const key = line.accountId;
      const existing = balances.get(key) || {
        code: line.ChartOfAccounts?.code ?? '',
        name: line.ChartOfAccounts?.name ?? '',
        debit: 0,
        credit: 0,
      };
      existing.debit += Number(line.debit);
      existing.credit += Number(line.credit);
      balances.set(key, existing);
    }
    return Array.from(balances.values());
  }
}