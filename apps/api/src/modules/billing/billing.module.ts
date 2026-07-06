/**
 * omyxia v2.0.0 P4.1 — BillingModule (facade).
 *
 * Wraps StripeModule so future billing concerns (e.g. usage metering in
 * P4.2, manual invoice adjustment in P5.x) can be added without
 * restructuring the imports of AppModule.
 */

import { Module } from '@nestjs/common';
import { StripeModule } from './stripe/stripe.module';

@Module({
  imports: [StripeModule],
})
export class BillingModule {}
