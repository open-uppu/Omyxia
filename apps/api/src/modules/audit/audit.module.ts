import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TenantContextModule } from '../../common/tenant-context/tenant-context.module';

/**
 * AuditLogsModule — read-only API for AuditLog records.
 * The write side (middleware) lives in common/audit/audit.module.ts as a global
 * middleware. We intentionally do NOT re-export `AuditModule` here to avoid a
 * name collision with that global module.
 */
@Module({
  imports: [PrismaModule, TenantContextModule, AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditLogsModule {}
