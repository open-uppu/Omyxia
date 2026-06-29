import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledReportsService } from './scheduled-reports.service';
import { ExportService } from '../../common/export/export.service';

class FakeTenantCtx {
  public current = '';
  set(t: string) {
    this.current = t;
  }
  getTenantId() {
    return this.current;
  }
}

describe('ScheduledReportsService', () => {
  let exporter: { export: ReturnType<typeof vi.fn> };
  let tenantCtx: FakeTenantCtx;
  let svc: ScheduledReportsService;

  beforeEach(() => {
    exporter = {
      export: vi.fn().mockReturnValue({ contentType: 'text/csv', body: 'a,b\n1,x' }),
    };
    tenantCtx = new FakeTenantCtx();
    svc = new ScheduledReportsService(
      exporter as unknown as ExportService,
      tenantCtx as any,
    );
  });

  it('create: stamps id + tenantId from context', () => {
    tenantCtx.set('tenant-A');
    const r = svc.create({
      name: 'Weekly Sales',
      recipients: ['a@b.c'],
      format: 'csv',
      cronExpression: '0 8 * * 1',
    });
    expect(r.id).toMatch(/^sr-/);
    expect(r.tenantId).toBe('tenant-A');
    expect(r.name).toBe('Weekly Sales');
  });

  it('list: only returns reports for current tenant', () => {
    // Create two reports under different tenants.
    tenantCtx.set('tenant-A');
    const aReport = svc.create({
      name: 'A1',
      recipients: [],
      format: 'csv',
      cronExpression: '* * * * *',
    });
    tenantCtx.set('tenant-B');
    svc.create({ name: 'B1', recipients: [], format: 'csv', cronExpression: '* * * * *' });

    // Switch back to tenant A and list — should only see A1
    tenantCtx.set('tenant-A');
    const visible = svc.list();
    expect(visible.length).toBe(1);
    expect(visible[0].name).toBe('A1');
    expect(visible[0].tenantId).toBe('tenant-A');
    expect(aReport.tenantId).toBe('tenant-A');
  });

  it('cancel: removes by id', () => {
    tenantCtx.set('tenant-A');
    const r = svc.create({
      name: 'X',
      recipients: [],
      format: 'csv',
      cronExpression: '* * * * *',
    });
    expect(svc.cancel(r.id)).toBe(true);
    expect(svc.cancel('does-not-exist')).toBe(false);
  });

  it('runDue: respects lastRunAt gate', async () => {
    tenantCtx.set('tenant-A');
    const r1 = svc.create({
      name: 'R1',
      recipients: [],
      format: 'csv',
      cronExpression: '* * * * *',
    });
    expect(r1.lastRunAt).toBeUndefined();
    await svc.runDue();
    expect(r1.lastRunAt).toBeDefined();
  });

  it('runDue: exports payload via exporter', async () => {
    tenantCtx.set('tenant-A');
    svc.create({
      name: 'R1',
      recipients: ['sales@x'],
      format: 'xlsx',
      cronExpression: '* * * * *',
    });
    await svc.runDue();
    expect(exporter.export).toHaveBeenCalledWith(expect.any(Array), 'xlsx');
  });
});
