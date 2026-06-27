require('./node_modules/.pnpm/dotenv@16.4.5/node_modules/dotenv').config({path: '.env'});
const { PrismaClient } = require('./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/default.js');
const bcrypt = require('./node_modules/.pnpm/bcryptjs@2.4.3/node_modules/bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding...');
  const passwordHash = await bcrypt.hash('demo123!', 12);
  
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-th-demo' },
    create: { slug: 'acme-th-demo', name: 'ACME Thailand Demo' },
    update: {}
  });
  console.log('✅ Tenant:', tenant.slug, tenant.id);
  
  const user = await prisma.user.upsert({
    where: { email: 'admin@acme-th.demo' },
    create: { email: 'admin@acme-th.demo', passwordHash, name: 'Demo Admin', emailVerified: new Date() },
    update: { passwordHash }
  });
  console.log('✅ User:', user.email, user.id);
  
  // Use findFirst + create/update for compound unique
  const existingMembership = await prisma.userTenant.findFirst({
    where: { userId: user.id, tenantId: tenant.id }
  });
  if (!existingMembership) {
    await prisma.userTenant.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', active: true }
    });
  } else {
    await prisma.userTenant.update({
      where: { id: existingMembership.id },
      data: { role: 'OWNER', active: true }
    });
  }
  console.log('✅ UserTenant link');
  
  const existingDept = await prisma.department.findFirst({ where: { tenantId: tenant.id, code: 'SALES' } });
  const dept = existingDept || await prisma.department.create({
    data: { tenantId: tenant.id, code: 'SALES', name: 'Sales Department' }
  });
  console.log('✅ Department:', dept.name);
  
  const existingPos = await prisma.position.findFirst({ where: { tenantId: tenant.id, code: 'MGR' } });
  const position = existingPos || await prisma.position.create({
    data: { tenantId: tenant.id, code: 'MGR', title: 'Sales Manager', level: 3 }
  });
  console.log('✅ Position:', position.title);
  
  const existingEmp = await prisma.employee.findFirst({ where: { tenantId: tenant.id, employeeNo: 'EMP001' } });
  if (!existingEmp) {
    await prisma.employee.create({
      data: {
        tenantId: tenant.id,
        employeeNo: 'EMP001',
        firstName: 'Somchai',
        lastName: 'Demo',
        email: 'somchai@acme-th.demo',
        hireDate: new Date('2024-01-15'),
        departmentId: dept.id,
        positionId: position.id,
        baseSalary: 50000
      }
    });
  }
  console.log('✅ Employee: Somchai Demo');
  
  console.log('\n✅ Seed complete!');
  console.log('   Login: admin@acme-th.demo / demo123!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
