/**
 * omyxia v2.0.0 P4.1 — StripeWebhookController.
 *
 * Receives POST requests from Stripe on `customer.subscription.*`,
 * `invoice.paid`, and `invoice.payment_failed`, then dispatches to
 * `EntitlementsSyncService`.
 *
 * Hard rules (per Stripe docs https://stripe.com/docs/webhooks):
 *   1. Use the **raw** request body when verifying the signature —
 *      any re-serialisation breaks the HMAC.
 *   2. Respond with HTTP 200 only AFTER the event is fully processed
 *      (or durably persisted for retry). Stripe will retry up to 3 days
 *      on anything else.
 *   3. Reject the event if signature verification fails — never trust
 *      the body. Even if the ID is one we've seen before, drop the
 *      request with 401 if the signature fails (a forged event with a
 *      reused ID would otherwise cause us to act on it twice).
 *   4. Be idempotent — Stripe may deliver the same event more than once.
 *      We back this with the unique-stripeEventId constraint on
 *      `StripeWebhookEvent`.
 *
 * In test mode the signing secret is optional; `verifySignature` is a
 * no-op and the controller accepts unsigned events so the unit tests can
 * exercise the sync logic without mocking crypto.
 */

import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import {
  STRIPE_SECRET_KEY_ENV,
  STRIPE_SIGNATURE_HEADER,
  STRIPE_WEBHOOK_SECRET_ENV,
} from './stripe.constants';
import { EntitlementsSyncService } from './entitlements-sync.service';

interface StripeRequest {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

@Controller('api/billing/stripe/webhook')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;
  private readonly testMode: boolean;

  constructor(private readonly sync: EntitlementsSyncService) {
    const rawKey = process.env[STRIPE_SECRET_KEY_ENV]?.trim() ?? '';
    this.webhookSecret = process.env[STRIPE_WEBHOOK_SECRET_ENV]?.trim() ?? '';
    const explicitTest = (process.env.STRIPE_TEST_MODE ?? '').toLowerCase() === 'true';
    this.testMode = rawKey === '' || explicitTest;
    if (this.testMode) {
      this.client = null;
      this.logger.warn(
        'StripeWebhookController running in TEST MODE — signature verification is DISABLED.',
      );
      return;
    }
    this.client = new Stripe(rawKey, { apiVersion: '2025-09-30.clover', typescript: true });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Req() req: Request): Promise<{ received: true; status: string }> {
    const rawBody = (req as unknown as StripeRequest).rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('missing raw body (set rawBody:true in NestFactory.create)');
    }

    const signature = this.readHeader(req, STRIPE_SIGNATURE_HEADER);
    const event = this.verifySignature(rawBody, signature);

    if (!event.id || !event.type) {
      throw new BadRequestException('event missing id/type');
    }

    const reserved = await this.sync.reserveWebhookEvent({
      stripeEventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      payload: event,
    });

    if (!reserved.reserved && reserved.existing) {
      // Duplicate delivery — return whatever state we last recorded. We do
      // NOT re-run the sync; Stripe sees 200 and stops retrying.
      this.logger.log(
        `Skipping duplicate Stripe event ${event.id} (${event.type}); existing status=${reserved.existing.status}`,
      );
      return { received: true, status: reserved.existing.status };
    }

    const receipt = await this.sync.handleEvent({
      existing: reserved.existing!,
      event: event as unknown as { type: string; data: { object: unknown }; livemode?: boolean },
    });

    return { received: true, status: receipt.status };
  }

  // ---------------------------------------------------------------------
  // Signature verification
  // ---------------------------------------------------------------------

  /**
   * Verify the Stripe webhook signature. In test mode the secret is
   * optional; when present we still verify, when absent we accept
   * unsigned events so dev / CI runs don't need a whsec round-trip.
   */
  private verifySignature(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    if (this.testMode) {
      if (!this.webhookSecret) {
        try {
          return JSON.parse(rawBody.toString('utf8')) as Stripe.Event;
        } catch (err) {
          throw new BadRequestException(
            `Invalid JSON body in test mode: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      try {
        return Stripe.webhooks.constructEvent(rawBody, signature ?? '', this.webhookSecret);
      } catch (err) {
        throw new BadRequestException(
          `Invalid signature in test mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!signature) {
      throw new BadRequestException('missing stripe-signature header');
    }
    if (!this.webhookSecret) {
      this.logger.error(
        'STRIPE_WEBHOOK_SECRET is not configured; refusing to accept signed webhooks.',
      );
      throw new BadRequestException('webhook secret not configured');
    }
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      throw new BadRequestException(
        `Invalid signature: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private readHeader(req: Request, name: string): string | undefined {
    const raw = (req as unknown as StripeRequest).headers[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return raw ?? undefined;
  }
}
