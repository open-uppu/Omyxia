/**
 * FeatureGateModule — global Nest module wiring the entitlements service,
 * feature gate guard, admin endpoints, and the cross-replica
 * invalidation subscriber (P3.3).
 *
 * Registered as `@Global()` so any controller (CRM, ERP, HR, BI, …) can
 * `@UseGuards(FeatureGateGuard)` + `@RequiresFeature('module.crm')`
 * without re-importing the module.
 *
 * Imports `RedisModule` so the `RedisService` is available to
 * `EntitlementsService` + ensures the Redis client is initialised once
 * on app boot (was previously orphaned — see git log).
 *
 * P3.3 additions:
 *   - `EntitlementInvalidationSubscriber` is registered here so its
 *     `OnModuleInit` hook subscribes to the `entitlement:invalidate`
 *     Redis channel before any controller can fire an `invalidate()`.
 *   - `RealtimeGateway` is consumed via the global `RealtimeModule`
 *     (no need to import it explicitly).
 *   - `EntitlementsAdminService` provides transactional plan / add-on
 *     mutation helpers that always invalidate the cache so admin
 *     changes propagate to FE within seconds.
 */
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { TenantContextModule } from '../tenant-context/tenant-context.module';
import { EntitlementsService } from './entitlements.service';
import { EntitlementsAdminController } from './entitlements.controller';
import { FeatureGateGuard } from './feature-gate.guard';
import { UsageLookupService } from './usage-lookup.service';
import { EntitlementInvalidationSubscriber } from './entitlement-invalidation.subscriber';
import { EntitlementsAdminService } from './entitlements-admin.service';

@Global()
@Module({
  imports: [PrismaModule, RedisModule, TenantContextModule],
  controllers: [EntitlementsAdminController],
  providers: [
    EntitlementsService,
    FeatureGateGuard,
    UsageLookupService,
    EntitlementInvalidationSubscriber,
    EntitlementsAdminService,
  ],
  exports: [
    EntitlementsService,
    FeatureGateGuard,
    UsageLookupService,
    EntitlementsAdminService,
  ],
})
export class FeatureGateModule {}