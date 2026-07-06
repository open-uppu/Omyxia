/**
 * omyxia v2.0.0 P4.2 — MeteringModule.
 *
 * Wraps the four metering services + the admin controller. Imports
 * `StripeModule` so the `StripeMeteringService` can reach
 * `StripeService` for usage-record + invoice-item calls.
 *
 * Wired into the `BillingModule` facade so `AppModule` only needs to
 * import `BillingModule` — no API surface change required.
 *
 * Why a separate module:
 *   * Cron handlers register through `@nestjs/schedule` (already
 *     registered globally by `MailModule.forRoot`). We don't need
 *     `ScheduleModule.forRoot()` here.
 *   * The Redis advisory lock for cron concurrency lives behind the
 *     global `RedisService`, which is imported transitively via the
 *     `PrismaModule` global + `RedisModule` global.
 *   * Tests can spin up just `MeteringModule` + `StripeModule` without
 *     pulling in the entire app graph.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { RedisModule } from '../../../common/redis/redis.module';
import { TenantContextModule } from '../../../common/tenant-context/tenant-context.module';
import { StripeModule } from '../stripe/stripe.module';
import { UsageCollectorService } from './usage-collector.service';
import { StripeMeteringService } from './stripe-metering.service';
import { MeteringAggregationService } from './metering-aggregation.service';
import { OverageInvoiceService } from './overage-invoice.service';
import { MeteringCronService } from './metering-cron.service';
import { UsageAdminController } from './usage-admin.controller';

@Module({
  imports: [PrismaModule, RedisModule, TenantContextModule, StripeModule],
  controllers: [UsageAdminController],
  providers: [
    UsageCollectorService,
    StripeMeteringService,
    MeteringAggregationService,
    OverageInvoiceService,
    MeteringCronService,
  ],
  exports: [
    UsageCollectorService,
    StripeMeteringService,
    MeteringAggregationService,
    OverageInvoiceService,
    MeteringCronService,
  ],
})
export class MeteringModule {}