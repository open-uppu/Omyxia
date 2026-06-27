import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding demo tenant: acme-th-demo...');

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-th-demo' },
    create: {
      slug: 'acme-th-demo',
      name: 'ACME Thailand Demo',
      plan: 'GROWTH',
      status: 'ACTIVE',
    },
    update: {},
  });

  // Create admin user
  const passwordHash = await bcrypt.hash('demo123!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'admin@acme-th.demo' },
    create: {
      email: 'admin@acme-th.demo',
      passwordHash,
      name: 'Demo Admin',
      emailVerified: new Date(),
    },
    update: { passwordHash },
  });

  // Link user to tenant as OWNER
  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    create: { userId: user.id, tenantId: tenant.id, role: 'OWNER', active: true },
    update: {},
  });

  // Set tenant context via raw SQL (so RLS doesn't block inserts)
  await prisma.$executeRawUnsafe(`SET app.current_tenant = '${tenant.id}'`);

  // Seed Thai chart of accounts
  const accounts = [
    { code: '1000', name: 'Cash', type: 'ASSET' as const, normalBalance: 'DEBIT' as const },
    { code: '1100', name: 'Bank', type: 'ASSET' as const, normalBalance: 'DEBIT' as const },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const, normalBalance: 'DEBIT' as const },
    { code: '1300', name: 'Inventory', type: 'ASSET' as const, normalBalance: 'DEBIT' as const },
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY' as const, normalBalance: 'CREDIT' as const },
    { code: '2100', name: 'VAT Payable', type: 'LIABILITY' as const, normalBalance: 'CREDIT' as const },
    { code: '2200', name: 'WHT Payable', type: 'LIABILITY' as const, normalBalance: 'CREDIT' as const },
    { code: '3000', name: 'Owner Equity', type: 'EQUITY' as const, normalBalance: 'CREDIT' as const },
    { code: '4000', name: 'Sales Revenue', type: 'REVENUE' as const, normalBalance: 'CREDIT' as const },
    { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE' as const, normalBalance: 'DEBIT' as const },
    { code: '6000', name: 'Salaries Expense', type: 'EXPENSE' as const, normalBalance: 'DEBIT' as const },
    { code: '6100', name: 'Rent Expense', type: 'EXPENSE' as const, normalBalance: 'DEBIT' as const },
  ];
  for (const acc of accounts) {
    await prisma.chartOfAccounts.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: acc.code } },
      create: { ...acc, tenantId: tenant.id },
      update: {},
    });
  }

  // Seed tax rates
  const taxRates = [
    { type: 'VAT' as const, name: 'Thai VAT 7%', rate: 7.00 },
    { type: 'WHT_1' as const, name: 'WHT Transport 1%', rate: 1.00 },
    { type: 'WHT_2' as const, name: 'WHT Services 2%', rate: 2.00 },
    { type: 'WHT_3' as const, name: 'WHT Rent 3%', rate: 3.00 },
    { type: 'WHT_5' as const, name: 'WHT Professional 5%', rate: 5.00 },
  ];
  for (const tr of taxRates) {
    await prisma.taxRate.create({
      data: { ...tr, tenantId: tenant.id, effectiveFrom: new Date('2024-01-01') },
    }).catch(() => null); // skip duplicates
  }

  // Seed sample customer
  await prisma.customer.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'CUST001' } },
    create: {
      tenantId: tenant.id,
      code: 'CUST001',
      name: 'Bangkok Trading Co.',
      email: 'ar@bangkoktrading.test',
      paymentTerms: 30,
    },
    update: {},
  });

  // Seed sample vendor
  await prisma.vendor.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'VEND001' } },
    create: {
      tenantId: tenant.id,
      code: 'VEND001',
      name: 'Thai Supplies Ltd.',
      email: 'ap@thaisupplies.test',
      paymentTerms: 30,
    },
    update: {},
  });

  // Seed department
  const dept = await prisma.department.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'SALES' } },
    create: { tenantId: tenant.id, code: 'SALES', name: 'Sales Department' },
    update: {},
  });

  // Seed position
  const position = await prisma.position.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MGR' } },
    create: { tenantId: tenant.id, code: 'MGR', title: 'Sales Manager', level: 3 },
    update: {},
  });

  // Seed demo employee
  await prisma.employee.upsert({
    where: { tenantId_employeeNo: { tenantId: tenant.id, employeeNo: 'EMP001' } },
    create: {
      tenantId: tenant.id,
      employeeNo: 'EMP001',
      firstName: 'Somchai',
      lastName: 'Demo',
      thFirstName: 'สมชาย',
      thLastName: 'เดโม',
      email: 'somchai@acme-th.demo',
      hireDate: new Date('2024-01-15'),
      departmentId: dept.id,
      positionId: position.id,
      baseSalary: 50000,
      employmentType: 'FULL_TIME',
    },
    update: {},
  });

  console.log('✅ Seed complete!');
  console.log('   Tenant: acme-th-demo');
  console.log('   User: admin@acme-th.demo / demo123!');
  console.log('   12 chart of accounts + 5 tax rates + 1 customer + 1 vendor + 1 employee');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
