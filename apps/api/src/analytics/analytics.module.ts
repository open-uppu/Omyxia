import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PrismaModule } from '../common/prisma/prisma.module';
import { TenantContextModule } from '../common/tenant-context/tenant-context.module';

@Module({
  imports: [PrismaModule, TenantContextModule],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}