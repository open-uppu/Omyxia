import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantContextModule } from './common/tenant-context/tenant-context.module';
import { AuditModule } from './common/audit/audit.module';
import { AuditLogsModule } from './modules/audit/audit.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { RbacModule } from './modules/auth/rbac/rbac.module';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './modules/auth/rbac/roles.guard';
import { TenantsModule } from './modules/tenants/tenants.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { HrModule } from './modules/hr/hr.module';
import { ErpModule } from './modules/erp/erp.module';
import { CrmModule } from './modules/crm/crm.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { SpecializedModule } from './modules/specialized/specialized.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { HealthController } from './modules/health/health.controller';
import { StorageModule } from './storage/storage.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
      signOptions: { expiresIn: '7d' },
    }),
    PrismaModule,
    TenantContextModule,
    AuditModule,
    AuditLogsModule,
    MailModule,
    AuthModule,
    MfaModule,
    RbacModule,
    TenantsModule,
    EmployeesModule,
    DepartmentsModule,
    HrModule,
    ErpModule,
    CrmModule,
    WorkspaceModule,
    SpecializedModule,
    GovernanceModule,
    StorageModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AppModule {}