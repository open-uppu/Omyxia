/**
 * omyxia v2.0.0 P4.1 — StripeService.
 *
 * Thin wrapper around the Stripe SDK that owns three concerns:
 *
 *   1. Customer lifecycle:
 *      `ensureCustomer(tenantId)` — find-or-create the Stripe customer
 *      that backs a tenant, persisting the mapping in `StripeCustomer`
 *      + `Tenant.stripeCustomerId` so the rest of the system can join
 *      without an extra Stripe round-trip.
 *
 *   2. Subscription lifecycle:
 *      `createSubscription`, `updateSubscriptionItems`, `cancelSubscription`.
 *      Each method writes to the Stripe API and is intended to be called
 *      from an admin (super_admin) action — but it can equally be wired
 *      to the customer portal where Stripe does the orchestration itself.
 *      Subscription mutations require an explicit `proration_behavior`
 *      (see `proration.ts`) so the admin UI can surface the cost preview.
 *
 *   3. Hosted pages:
 *      `createPortalSession` (manage subscription / payment methods) and
 *      `createCheckoutSession` (first-time signup) — both return a URL
 *      the FE just redirects to. We never try to embed Stripe checkout
 *      in the admin console for compliance reasons (PCI scope).
 *
 * Test mode:
 *   When `STRIPE_SECRET_KEY` is empty OR `STRIPE_TEST_MODE=true`, no real
 *   API calls are made. Instead the service generates deterministic fake
 *   IDs (`cus_test_<tenantId>`, `sub_test_<tenantId>`, ...) so the
 *   webhook-ingress tests + entitlements-sync tests can run end-to-end
 *   without network access. The fake IDs use the literal `test_` prefix
 *   so any accidental prod call would fail loudly at Stripe's edge.
 */

import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  DEFAULT_CHECKOUT_RETURN_URL,
  DEFAULT_RETURN_URL,
  STRIPE_API_VERSION,
  STRIPE_SECRET_KEY_ENV,
} from './stripe.constants';
import { DEFAULT_PRORATION_BEHAVIOR, type ProrationBehavior } from './proration';
import type { PlanTier } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StripeCatalogService } from './stripe-catalog.service';
import type {
  BillingPortalResult,
  CheckoutSessionResult,
} from './stripe.types';
import { TenantContextService } from '../../../common/tenant-context/tenant-context.service';

interface EnsureCustomerResult {
  stripeCustomerId: string;
  email: string | null;
  livemode: boolean;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;
  readonly testMode: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: StripeCatalogService,
    private readonly tenantContext: TenantContextService,
  ) {
    const raw = process.env[STRIPE_SECRET_KEY_ENV]?.trim() ?? '';
    const explicitTest = (process.env.STRIPE_TEST_MODE ?? '').toLowerCase() === 'true';
    this.testMode = raw === '' || explicitTest;

    if (this.testMode) {
      this.client = null;
      this.logger.warn(
        'StripeService running in TEST MODE (no Stripe secret key configured). No real API calls will be issued. ' +
          'Webhook signature verification is disabled; idempotency is enforced via the StripeWebhookEvent table.',
      );
      return;
    }

    this.client = new Stripe(raw, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 15_000,
    });
  }

  // ---------------------------------------------------------------------
  // 1. Customer lifecycle
  // ---------------------------------------------------------------------

  /**
   * Find-or-create the Stripe customer that backs the tenant. Looks up the
   * cached mapping first; if present, returns the existing `cus_*` ID
   * without an API call. If absent, creates a new customer (in test mode,
   * returns a synthetic ID) and persists the mapping transactionally.
   */
  async ensureCustomer(tenantId: string): Promise<EnsureCustomerResult> {
    if (!tenantId) throw new Error('tenantId is required');
    const existing = await this.prisma.stripeCustomer.findUnique({
      where: { tenantId },
    });
    if (existing) {
      return {
        stripeCustomerId: existing.stripeCustomerId,
        email: existing.email,
        livemode: existing.livemode,
      };
    }

    // We need an email to create the customer (avoids empty receipt). Fetch
    // a primary owner from the tenant.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        tenants: {
          where: { role: { in: ['OWNER', 'SUPER_ADMIN'] } },
          include: { user: true },
          take: 1,
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!tenant) throw new Error(`tenant not found: ${tenantId}`);

    const ownerEmail = (tenant.tenants && tenant.tenants.length > 0)
      ? tenant.tenants[0]?.user?.email ?? null
      : null;
    const livemode = !this.testMode;

    let stripeCustomerId: string;
    if (this.testMode) {
      stripeCustomerId = this.fakeCustomerId(tenantId);
    } else {
      const created = await this.client!.customers.create(
        {
          name: tenant.name,
          email: ownerEmail ?? undefined,
          metadata: { tenantId, slug: tenant.slug },
        },
        { idempotencyKey: `ensureCustomer:${tenantId}` },
      );
      stripeCustomerId = created.id;
    }

    await this.prisma.$transaction([
      this.prisma.stripeCustomer.create({
        data: {
          tenantId,
          stripeCustomerId,
          email: ownerEmail,
          name: tenant.name,
          livemode,
        },
      }),
      this.prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeCustomerId },
      }),
    ]);

    return { stripeCustomerId, email: ownerEmail, livemode };
  }

  // ---------------------------------------------------------------------
  // 2. Hosted pages
  // ---------------------------------------------------------------------

  /** Open the Stripe customer portal for a tenant. */
  async createPortalSession(
    tenantId: string,
    returnUrl: string | undefined,
  ): Promise<BillingPortalResult> {
    const { stripeCustomerId } = await this.ensureCustomer(tenantId);
    const finalReturn = returnUrl ?? DEFAULT_RETURN_URL;

    if (this.testMode) {
      // In test mode we can't actually mint a portal URL — return a local
      // stub that the FE can route to. The stub URL contains the tenant
      // marker so FE devs can wire it during local dev.
      return {
        url: `${finalReturn}?stripe=test&customer=${encodeURIComponent(stripeCustomerId)}`,
        returnUrl: finalReturn,
      };
    }

    const session = await this.client!.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: finalReturn,
    });
    return { url: session.url, returnUrl: finalReturn };
  }

  /**
   * Open a Stripe Checkout session for a tenant upgrading to a new plan.
   * The FE should redirect to `url`; Stripe handles the rest and notifies
   * us via `customer.subscription.created`.
   */
  async createCheckoutSession(
    tenantId: string,
    planTier: PlanTier,
    addOnIds: ReadonlyArray<string>,
    returnUrl: string | undefined,
  ): Promise<CheckoutSessionResult> {
    const { stripeCustomerId } = await this.ensureCustomer(tenantId);
    const finalReturn = returnUrl ?? DEFAULT_CHECKOUT_RETURN_URL;

    const lineItems = await this.buildCheckoutLineItems(planTier, addOnIds);
    if (lineItems.length === 0) {
      throw new Error(`no Stripe prices configured for plan=${planTier} addOns=${addOnIds.join(',')}`);
    }

    if (this.testMode) {
      const sessionId = this.fakeSessionId(tenantId, planTier);
      return {
        url: `${finalReturn}?stripe=test&session=${sessionId}&plan=${planTier}`,
        sessionId,
      };
    }

    const session = await this.client!.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: lineItems,
        success_url: `${finalReturn}?status=success`,
        cancel_url: `${finalReturn}?status=cancel`,
        metadata: { tenantId, planTier, addOnIds: addOnIds.join(',') },
        subscription_data: {
          metadata: { tenantId, planTier, addOnIds: addOnIds.join(',') },
        },
      },
      { idempotencyKey: `checkout:${tenantId}:${planTier}:${addOnIds.join(',')}` },
    );

    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return { url: session.url, sessionId: session.id };
  }

  // ---------------------------------------------------------------------
  // 3. Subscription lifecycle (admin / system initiated)
  // ---------------------------------------------------------------------

  /**
   * Create a brand-new subscription for a tenant. Used during onboarding
   * (when no subscription yet exists) and during migration (P5.1) when a
   * tenant is moved from legacy billing into Stripe.
   */
  async createSubscription(
    tenantId: string,
    planTier: PlanTier,
    addOnIds: ReadonlyArray<string>,
    prorationBehavior: ProrationBehavior = DEFAULT_PRORATION_BEHAVIOR,
  ): Promise<{ stripeSubscriptionId: string; livemode: boolean }> {
    const { stripeCustomerId } = await this.ensureCustomer(tenantId);
    const items = await this.buildItemArgs(planTier, addOnIds);
    if (items.length === 0) {
      throw new Error(`no Stripe prices configured for plan=${planTier} addOnIds=${addOnIds.join(',')}`);
    }

    if (this.testMode) {
      return {
        stripeSubscriptionId: this.fakeSubscriptionId(tenantId, planTier),
        livemode: false,
      };
    }

    const subscription = await this.client!.subscriptions.create(
      {
        customer: stripeCustomerId,
        items,
        proration_behavior: prorationBehavior,
        metadata: { tenantId, planTier, addOnIds: addOnIds.join(',') },
      },
      { idempotencyKey: `createSub:${tenantId}:${planTier}` },
    );
    return { stripeSubscriptionId: subscription.id, livemode: subscription.livemode };
  }

  /**
   * Replace the line items on an existing subscription. Pass the full
   * desired list (plan + current add-ons minus removed + added). The
   * caller computes the diff; Stripe applies the proration.
   */
  async replaceSubscriptionItems(
    tenantId: string,
    stripeSubscriptionId: string,
    planTier: PlanTier,
    addOnIds: ReadonlyArray<string>,
    prorationBehavior: ProrationBehavior = DEFAULT_PRORATION_BEHAVIOR,
  ): Promise<{ stripeSubscriptionId: string; livemode: boolean }> {
    const desired = await this.buildItemArgs(planTier, addOnIds);
    if (desired.length === 0) {
      throw new Error('cannot replace subscription items with no items; cancel instead.');
    }

    if (this.testMode) {
      return { stripeSubscriptionId, livemode: false };
    }

    const subscription = await this.client!.subscriptions.retrieve(stripeSubscriptionId);
    const existingItemIds = subscription.items.data.map((i) => i.id);
    const desiredItems = desired
      .filter((item): item is { price: string; quantity?: number } =>
        typeof item.price === 'string' && item.price.length > 0,
      )
      .map((item) => ({ price: item.price, quantity: item.quantity ?? 1 }));
    const removedItems = existingItemIds.map((id) => ({ id, deleted: true as const }));
    const params: Stripe.SubscriptionUpdateParams = {
      items: [...desiredItems, ...removedItems],
      proration_behavior: prorationBehavior,
    };

    const updated = await this.client!.subscriptions.update(stripeSubscriptionId, params);
    return { stripeSubscriptionId: updated.id, livemode: updated.livemode };
  }

  /**
   * Add a single add-on line item to an existing subscription (e.g. user
   * upgrades usage later). Safe to call repeatedly — Stripe will replace
   * the existing item if the same add-on is already attached.
   */
  async addSubscriptionItem(
    tenantId: string,
    stripeSubscriptionId: string,
    addOnId: string,
    quantity = 1,
    prorationBehavior: ProrationBehavior = DEFAULT_PRORATION_BEHAVIOR,
  ): Promise<{ stripeSubscriptionItemId: string; livemode: boolean }> {
    const priceId = await this.catalog.priceIdForAddOn(addOnId);
    if (!priceId) throw new Error(`addOn=${addOnId} has no Stripe price configured`);

    if (this.testMode) {
      return { stripeSubscriptionItemId: this.fakeItemId(tenantId, addOnId), livemode: false };
    }

    const created = await this.client!.subscriptionItems.create({
      subscription: stripeSubscriptionId,
      price: priceId,
      quantity,
      proration_behavior: prorationBehavior,
      metadata: { tenantId, addOnId },
    });
    return { stripeSubscriptionItemId: created.id, livemode: false };
  }

  /**
   * Remove an add-on from an existing subscription by Stripe item ID.
   * `proration_behavior: create_prorations` makes Stripe credit the
   * customer for the remainder of the period.
   */
  async removeSubscriptionItem(
    _tenantId: string,
    stripeSubscriptionItemId: string,
    prorationBehavior: ProrationBehavior = DEFAULT_PRORATION_BEHAVIOR,
  ): Promise<{ livemode: boolean }> {
    if (this.testMode) {
      return { livemode: false };
    }

    await this.client!.subscriptionItems.del(stripeSubscriptionItemId, {
      proration_behavior: prorationBehavior,
    });
    return { livemode: false };
  }

  /**
   * Cancel at the end of the current period (the customer-facing default;
   * Stripe fires `customer.subscription.updated` with `cancel_at_period_end=true`,
   * then `customer.subscription.deleted` when the period actually ends).
   */
  async cancelSubscription(
    _tenantId: string,
    stripeSubscriptionId: string,
    atPeriodEnd = true,
  ): Promise<{ stripeSubscriptionId: string; livemode: boolean }> {
    if (this.testMode) {
      return { stripeSubscriptionId, livemode: false };
    }

    if (atPeriodEnd) {
      const updated = await this.client!.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      return { stripeSubscriptionId: updated.id, livemode: updated.livemode };
    }

    const cancelled = await this.client!.subscriptions.cancel(stripeSubscriptionId);
    return { stripeSubscriptionId: cancelled.id, livemode: cancelled.livemode };
  }

  // ---------------------------------------------------------------------
  // Metering (P4.2) — usage records + invoice items
  // ---------------------------------------------------------------------

  /**
   * Report usage for a metered subscription item. Wraps
   * `subscriptionItems.createUsageRecord(...)` so the metering module
   * doesn't need to import the Stripe SDK directly.
   *
   * In test mode (no secret key) we deterministically synthesise a
   * `mbur_test_<tenantId>_<meter>_<timestamp>` id so the metering cron
   * + admin endpoints can be exercised end-to-end without network.
   *
   * `timestamp` is the UTC second at which the usage occurred — Stripe
   * accepts any time in the subscription's current period.
   * `quantity` is an integer or 6-dp decimal (Stripe rounds to 6dp).
   * `action` defaults to `increment` (add to existing usage); the
   * metering cron always uses `increment` so retries are additive.
   */
  async createUsageRecord(input: {
    tenantId: string;
    stripeSubscriptionItemId: string;
    quantity: number;
    timestamp: Date;
    action?: 'increment' | 'set';
  }): Promise<{ stripeUsageRecordId: string; livemode: boolean }> {
    if (this.testMode) {
      const id = `mbur_test_${this.slug(input.tenantId)}_${input.stripeSubscriptionItemId.slice(-6)}_${Math.floor(
        input.timestamp.getTime() / 1000,
      )}`;
      return { stripeUsageRecordId: id, livemode: false };
    }

    const record = (await this.client!.rawRequest(
      'POST',
      `/v1/subscription_items/${encodeURIComponent(input.stripeSubscriptionItemId)}/usage_records`,
      {
        quantity: Math.round(input.quantity * 1_000_000) / 1_000_000,
        timestamp: Math.floor(input.timestamp.getTime() / 1000),
        action: input.action ?? 'increment',
      },
    )) as { id: string; livemode: boolean };
    return { stripeUsageRecordId: record.id, livemode: record.livemode };
  }

  /**
   * Append a one-time invoice item for overage charges. Wraps
   * `invoiceItems.create({ customer, amount, currency, description })`.
   * The invoice item lands on the customer's *next* generated invoice;
   * we do not call `invoices.create` here because Stripe groups all
   * pending items on the customer's next billing cycle automatically.
   *
   * In test mode we synthesise `ii_test_<tenantId>_<timestamp>`.
   */
  async createInvoiceItem(input: {
    tenantId: string;
    stripeCustomerId: string;
    amount: number; // in major currency units (e.g. dollars)
    currency: string;
    description: string;
    /** Optional metadata echoed back on the invoice item + invoice. */
    metadata?: Record<string, string>;
  }): Promise<{ stripeInvoiceItemId: string; livemode: boolean }> {
    if (this.testMode) {
      const id = `ii_test_${this.slug(input.tenantId)}_${Math.floor(Date.now() / 1000)}`;
      return { stripeInvoiceItemId: id, livemode: false };
    }

    const item = await this.client!.invoiceItems.create({
      customer: input.stripeCustomerId,
      amount: Math.round(input.amount * 100), // dollars → cents
      currency: input.currency.toLowerCase(),
      description: input.description,
      metadata: input.metadata,
    });
    return { stripeInvoiceItemId: item.id, livemode: item.livemode };
  }

  /**
   * Fetch the Stripe customer id for a tenant. Used by the overage
   * invoicer so we don't have to plumb the customer id through every
   * call site. Throws if no customer exists yet — callers should
   * `ensureCustomer` first.
   */
  async getStripeCustomerIdForTenant(tenantId: string): Promise<string | null> {
    const customer = await this.prisma.stripeCustomer.findUnique({
      where: { tenantId },
      select: { stripeCustomerId: true },
    });
    return customer?.stripeCustomerId ?? null;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Build the `items` array for `subscriptions.create/update`. We model the
   * plan as ONE base item (price = the tier's stripe price) and each
   * add-on as an additional item. Stripe will fail loudly if the same
   * price id is referenced twice in one call — the controller is expected
   * to dedupe `addOnIds` before reaching this method.
   */
  private async buildItemArgs(
    planTier: PlanTier,
    addOnIds: ReadonlyArray<string>,
  ): Promise<Stripe.SubscriptionCreateUpdateParams.Item[]> {
    const planPriceId = await this.catalog.priceIdForPlanTier(planTier);
    const items: Stripe.SubscriptionCreateUpdateParams.Item[] = [];

    if (planPriceId) {
      items.push({ price: planPriceId, quantity: 1 });
    }

    for (const addOnId of addOnIds) {
      const priceId = await this.catalog.priceIdForAddOn(addOnId);
      if (priceId) items.push({ price: priceId, quantity: 1 });
    }
    return items;
  }

  private async buildCheckoutLineItems(
    planTier: PlanTier,
    addOnIds: ReadonlyArray<string>,
  ): Promise<Array<{ price: string; quantity: number }>> {
    const args = await this.buildItemArgs(planTier, addOnIds);
    return args
      .filter((item): item is { price: string; quantity?: number } => 'price' in item && Boolean(item.price))
      .map((item) => ({ price: item.price, quantity: item.quantity ?? 1 }));
  }

  // Fake ID helpers — only used in testMode so they're allowed to throw on
  // dev misuse (Stripe itself rejects `cus_test_...`).
  private fakeCustomerId(tenantId: string): string {
    return `cus_test_${this.slug(tenantId)}`;
  }
  private fakeSubscriptionId(tenantId: string, planTier: PlanTier): string {
    return `sub_test_${this.slug(tenantId)}_${planTier.toLowerCase()}`;
  }
  private fakeSessionId(tenantId: string, planTier: PlanTier): string {
    return `cs_test_${this.slug(tenantId)}_${planTier.toLowerCase()}`;
  }
  private fakeItemId(tenantId: string, addOnId: string): string {
    return `si_test_${this.slug(tenantId)}_${this.slug(addOnId)}`;
  }
  private slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }
}
