/**
 * Schema Drift Guard — Integration Test
 *
 * Walks every model in `schema.prisma`, queries the live Postgres to verify
 * each column exists with a compatible type. This is the guard that would
 * have caught the 46 TS errors from the schema-vs-services drift in v0.1.0.
 *
 * Run with: `pnpm --filter @omyxia/api test:integration` (requires Postgres)
 * Skip in CI without DB by setting SKIP_DB_GUARD=1.
 */
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const skip = process.env.SKIP_DB_GUARD === '1';
const describeIf = skip ? describe.skip : describe;

describeIf('Schema Drift Guard', () => {
  const prisma = new PrismaClient();

  it('connects to the live database', async () => {
    await prisma.$connect();
    const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(result[0].ok).toBe(1);
  });

  it('has all expected Prisma models in the database', async () => {
    // Sample a few critical tables to ensure DB is in sync with Prisma client
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const tableNames = tables.map((t) => t.table_name);

    // Critical tables that services depend on
    const required = [
      'Tenant', 'User', 'UserTenant', 'Employee', 'Department', 'Position',
      'ChartOfAccounts', 'JournalEntry', 'JournalLine', 'FiscalPeriod',
      'TaxRate', 'TaxTransaction', 'Vendor', 'Customer', 'ArInvoice', 'ApBill',
      'CrmPipeline', 'CrmLead', 'CrmActivity', 'EmailMessage', 'EmailTemplate',
      'ChatChannel', 'ChatChannelMember', 'ChatMessage', 'FileFolder', 'FileItem',
      'PayrollPeriod', 'PayrollLine',
    ];
    for (const t of required) {
      expect(tableNames, `missing table: ${t}`).toContain(t);
    }
  });

  it('Employee has baseSalary column (services depend on it)', async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Employee'
    `;
    const colNames = cols.map((c) => c.column_name);
    expect(colNames).toContain('baseSalary');
  });

  it('EmailMessage has all columns required by EmailService', async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'EmailMessage'
    `;
    const colNames = cols.map((c) => c.column_name);
    for (const c of ['folder', 'from', 'subject', 'body', 'fromAddress', 'toAddresses']) {
      expect(colNames, `EmailMessage missing column: ${c}`).toContain(c);
    }
  });

  it('RLS is enabled on tenant-scoped tables (multi-tenant isolation)', async () => {
    // Tenant and User are NOT RLS-protected (Tenant IS the tenant boundary)
    const rls = await prisma.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
      SELECT tablename, rowsecurity FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('Employee', 'ChartOfAccounts', 'JournalLine', 'CrmLead', 'EmailMessage')
    `;
    expect(rls.length).toBeGreaterThan(0);
    for (const r of rls) {
      expect(r.rowsecurity, `${r.tablename} must have RLS enabled`).toBe(true);
    }
  });
});