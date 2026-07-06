/**
 * FeatureGateModule — global Nest module wiring the entitlements service,
 * feature gate guard, and admin endpoint.
 *
 * Registered as `@Global()` so any controller (CRM, ERP, HR, BI, …) can
 * `@UseGuards(FeatureGateGuard)` + `@RequiresFeature('module.crm')`
 * without re-importing the module.
 *
 * Imports `RedisModule` so the `RedisService` is available to
 * `EntitlementsService` + ensures the Redis client is initialised once
 * on app boot (was previously orphaned — see git log).
 */
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { TenantContextModule } from '../tenant-context/tenant-context.module';
import { EntitlementsService } from './entitlements.service';
import { EntitlementsAdminController } from './entitlements.controller';
import { FeatureGateGuard } from './feature-gate.guard';
import { UsageLookupService } from './usage-lookup.service';

@Global()
@Module({
  imports: [PrismaModule, RedisModule, TenantContextModule],
  controllers: [EntitlementsAdminController],
  providers: [EntitlementsService, FeatureGateGuard, UsageLookupService],
  exports: [EntitlementsService, FeatureGateGuard, UsageLookupService],
})
export class FeatureGateModule {}
