import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExportService, ExportFormat } from '../../common/export/export.service';

export interface ScheduledReport {
  id: string;
  tenantId: string;
  name: string;
  recipients: string[];
  format: ExportFormat;
  cronExpression: string;
  lastRunAt?: Date;
}

/**
 * Stub interface — production would inject PrismaService here.
 * We accept an opaque `tenantId: string | (() => string)` so tests can
 * control the tenant without needing a full TenantContextService.
 */
interface TenantIdSource {
  getTenantId(): string;
}

@Injectable()
export class ScheduledReportsService {
  private readonly logger = new Logger(ScheduledReportsService.name);
  private readonly repo = new Map<string, ScheduledReport>();
  private counter = 0;

  constructor(
    private readonly exporter: ExportService,
    private readonly tenantCtx: TenantIdSource,
  ) {}

  create(input: Omit<ScheduledReport, 'id' | 'tenantId' | 'lastRunAt'>): ScheduledReport {
    this.counter += 1;
    const id = `sr-${Date.now()}-${this.counter}`;
    const sr: ScheduledReport = {
      id,
      tenantId: this.tenantCtx.getTenantId(),
      ...input,
    };
    this.repo.set(id, sr);
    return sr;
  }

  list(): ScheduledReport[] {
    const tenantId = this.tenantCtx.getTenantId();
    return Array.from(this.repo.values()).filter((r) => r.tenantId === tenantId);
  }

  cancel(id: string): boolean {
    return this.repo.delete(id);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runDue() {
    const now = new Date();
    for (const sr of this.repo.values()) {
      if (this.shouldRun(sr, now)) {
        try {
          await this.dispatch(sr);
          sr.lastRunAt = now;
        } catch (e) {
          this.logger.error(`Report ${sr.id} failed: ${(e as Error).message}`);
        }
      }
    }
  }

  protected shouldRun(sr: ScheduledReport, now: Date): boolean {
    if (!sr.lastRunAt) return true;
    return now.getTime() - sr.lastRunAt.getTime() >= 60 * 60 * 1000;
  }

  protected async dispatch(sr: ScheduledReport) {
    const payload = this.exporter.export(
      [{ report: sr.name, ts: Date.now() }],
      sr.format,
    );
    this.logger.log(
      `Would send "${sr.name}" (${sr.format}, ${(payload.body as any)?.length ?? '?'} bytes) to ${sr.recipients.join(', ')}`,
    );
  }
}
