/**
 * omyxia v2.0.0 P4.1 — StripeModule.
 *
 * Imports PrismaModule + RedisModule + TenantContextModule for the
 * service + sync layer. Exports StripeService + StripeCatalogService so
 * the admin console module (P2.5) can ask for price IDs when building
 * the plan-management UI.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { RedisModule } from '../../../common/redis/redis.module';
import { TenantContextModule } from '../../../common/tenant-context/tenant-context.module';
import { StripeService } from './stripe.service';
import { StripeCatalogService } from './stripe-catalog.service';
import { EntitlementsSyncService } from './entitlements-sync.service';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './webhook.controller';

@Module({
  imports: [PrismaModule, RedisModule, TenantContextModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [StripeService, StripeCatalogService, EntitlementsSyncService],
  exports: [StripeService, StripeCatalogService, EntitlementsSyncService],
})
export class StripeModule {}
