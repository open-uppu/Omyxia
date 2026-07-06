/**
 * omyxia v2.0.0 P4.1 + P4.2 — BillingModule (facade).
 *
 * Wraps StripeModule + MeteringModule so future billing concerns
 * (e.g. manual invoice adjustment in P5.x) can be added without
 * restructuring the imports of AppModule.
 */

import { Module } from '@nestjs/common';
import { StripeModule } from './stripe/stripe.module';
import { MeteringModule } from './metering/metering.module';

@Module({
  imports: [StripeModule, MeteringModule],
})
export class BillingModule {}
