/**
 * omyxia v2.0.0 P4.1 — EntitlementsSyncService.
 *
 * The bridge between Stripe webhooks and the entitlements layer. The
 * Stripe SDK delivers three flavours of events that impact tenant
 * capabilities:
 *
 *   * `customer.subscription.created|updated`  → mirror the line items
 *                                                 into `TenantEntitlement`
 *                                                 + `TenantEntitlementAddOn`.
 *   * `customer.subscription.deleted`          → mark entitlements expired
 *                                                 (status CANCELED →
 *                                                 effectiveAt=…, expiresAt=…
 *                                                 recorded for audit). The
 *                                                 plan/add-on rows are
 *                                                 NOT immediately deleted
 *                                                 — Stripe keeps the data
 *                                                 around for ~24h.
 *   * `invoice.paid` / `invoice.payment_failed` → append an audit-log row.
 *
 * In every case the service:
 *   1. Records the event in `StripeWebhookEvent` (idempotent).
 *   2. Mutates `StripeSubscription` / `StripeSubscriptionItem` snapshots
 *      (so the dashboard query in P2.2 has fresh data without hitting
 *      Stripe).
 *   3. Mutates `TenantEntitlement` / `TenantEntitlementAddOn` if the
 *      subscription is active.
 *   4. Invalidates the Redis entitlements cache so the next feature-gate
 *      call re-reads from the DB.
 *
 * Idempotency:
 *   We rely on the `StripeWebhookEvent` table's UNIQUE(stripeEventId) to
 *   block re-processing. The webhook controller is expected to upsert the
 *   row BEFORE calling `handleEvent()` so duplicate deliveries are caught.
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  StripeSubscription,
  StripeWebhookEvent,
  TenantEntitlement,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { StripeCatalogService } from './stripe-catalog.service';
import {
  HANDLED_WEBHOOK_EVENTS,
  SUBSCRIPTION_DEAD_GRACE_SECONDS,
  type HandledWebhookEvent,
} from './stripe.constants';
import {
  ACTIVE_STRIPE_STATUSES,
  TERMINAL_STRIPE_STATUSES,
  mapStripeStatus,
  type StripeSubscriptionSnapshot,
  type WebhookEventReceipt,
} from './stripe.types';
import { StripeService } from './stripe.service';

const ENTITLEMENTS_CACHE_PREFIX = 'entitlements:v1:';

interface SyncResult {
  ok: boolean;
  /** How many subscriptions were newly synced (1 expected for direct webhook). */
  subscriptionsAffected: number;
  /** Cache invalidations performed. */
  cacheInvalidations: string[];
}

@Injectable()
export class EntitlementsSyncService {
  private readonly logger = new Logger(EntitlementsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly catalog: StripeCatalogService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Pre-flight: ensure the event row exists in `StripeWebhookEvent` and
   * is still in `RECEIVED` status. If the row already exists with a
   * different status we return its current state — that's how duplicate
   * deliveries get caught without throwing. Called from the webhook
   * controller BEFORE signature is verified for early idempotency check,
   * and again immediately after to capture the verified payload.
   *
   * We look up the row first (rather than relying on a unique-constraint
   * exception) so the test mocks can simulate duplicates without having
   * to engineer a thrown error.
   */
  async reserveWebhookEvent(input: {
    stripeEventId: string;
    type: string;
    livemode: boolean;
    payload: unknown;
  }): Promise<{ reserved: boolean; existing?: StripeWebhookEvent }> {
    const existing = await this.prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: input.stripeEventId },
    });
    if (existing) {
      return { reserved: false, existing };
    }
    try {
      const created = await this.prisma.stripeWebhookEvent.create({
        data: {
          stripeEventId: input.stripeEventId,
          type: input.type,
          livemode: input.livemode,
          payload: input.payload as object,
        },
      });
      return { reserved: true, existing: created };
    } catch (err) {
      // A duplicate-key error means a parallel request reserved the row
      // between our lookup and our create. We re-fetch and return it.
      const raced = await this.prisma.stripeWebhookEvent.findUnique({
        where: { stripeEventId: input.stripeEventId },
      });
      if (!raced) throw err;
      return { reserved: false, existing: raced };
    }
  }

  /**
   * Process a Stripe webhook event that has been signature-verified and
   * reserved. Returns a structured receipt for the controller's response
   * and audit log.
   */
  async handleEvent(input: {
    existing: StripeWebhookEvent;
    event: { type: string; data: { object: unknown }; livemode?: boolean };
  }): Promise<WebhookEventReceipt> {
    const { existing, event } = input;
    const isHandled = (HANDLED_WEBHOOK_EVENTS as readonly string[]).includes(event.type);
    if (!isHandled) {
      const updated = await this.prisma.stripeWebhookEvent.update({
        where: { id: existing.id },
        data: { status: 'SKIPPED', processedAt: new Date() },
      });
      return this.receipt(updated);
    }
    try {
      switch (event.type as HandledWebhookEvent) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.applySubscriptionUpsert(
            event.data.object as Parameters<typeof this.applySubscriptionUpsert>[0],
          );
          break;
        case 'customer.subscription.deleted':
          await this.applySubscriptionDeleted(
            event.data.object as Parameters<typeof this.applySubscriptionDeleted>[0],
          );
          break;
        case 'invoice.paid':
        case 'invoice.payment_failed':
          await this.applyInvoiceLifecycle(
            event.data.object as Parameters<typeof this.applyInvoiceLifecycle>[0],
            event.type,
          );
          break;
      }
      const updated = await this.prisma.stripeWebhookEvent.update({
        where: { id: existing.id },
        data: { status: 'PROCESSED', processedAt: new Date(), errorMessage: null },
      });
      return this.receipt(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `StripeWebhookEvent ${existing.stripeEventId} (${existing.type}) failed: ${message}`,
      );
      const updated = await this.prisma.stripeWebhookEvent.update({
        where: { id: existing.id },
        data: { status: 'FAILED', errorMessage: message },
      });
      return this.receipt(updated);
    }
  }

  // ---------------------------------------------------------------------
  // Subscription upsert
  // ---------------------------------------------------------------------

  /**
   * Handle `customer.subscription.created|updated`. Mirrors the Stripe
   * subscription into our `StripeSubscription` + `StripeSubscriptionItem`
   * tables, then syncs the entitlement join tables, then invalidates the
   * Redis cache.
   */
  async applySubscriptionUpsert(subscription: unknown): Promise<SyncResult> {
    const snap = this.parseSubscriptionSnapshot(subscription);
    const tenant = await this.findTenantByStripeCustomer(snap.stripeCustomerId);
    if (!tenant) {
      this.logger.warn(
        `Subscription ${snap.stripeSubscriptionId} references unknown Stripe customer ${snap.stripeCustomerId} — skipping sync.`,
      );
      return { ok: false, subscriptionsAffected: 0, cacheInvalidations: [] };
    }

    const cachedInvalidations: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.stripeSubscription.upsert({
        where: { tenantId: tenant.id },
        create: this.stripeSubscriptionCreate(tenant.id, snap),
        update: this.stripeSubscriptionUpdate(snap),
      });

      // Refresh items in a single transaction. We soft-delete (isActive=false)
      // any items that aren't in the incoming payload rather than deleting —
      // Stripe occasionally sends a stale snapshot mid-update.
      const incoming = snap.items.map((item) => ({
        stripeSubscriptionItemId: item.stripeSubscriptionItemId,
        stripePriceId: item.stripePriceId,
        quantity: item.quantity,
        isActive: item.isActive,
      }));

      const existingItems = await tx.stripeSubscriptionItem.findMany({
        where: { subscription: { tenantId: tenant.id } },
      });

      const incomingIds = new Set(incoming.map((i) => i.stripeSubscriptionItemId));
      const inactiveIds = existingItems
        .filter((i) => !incomingIds.has(i.stripeSubscriptionItemId))
        .map((i) => i.id);

      if (inactiveIds.length > 0) {
        await tx.stripeSubscriptionItem.updateMany({
          where: { id: { in: inactiveIds } },
          data: { isActive: false, updatedAt: new Date() },
        });
      }

      const subscriptionId = (await tx.stripeSubscription.findUniqueOrThrow({
        where: { tenantId: tenant.id },
        select: { id: true },
      })).id;

      for (const item of incoming) {
        const lookup = await this.catalog.lookupPrice(item.stripePriceId);
        if (!lookup) continue;
        await tx.stripeSubscriptionItem.upsert({
          where: { stripeSubscriptionItemId: item.stripeSubscriptionItemId },
          create: {
            subscriptionId,
            stripeSubscriptionItemId: item.stripeSubscriptionItemId,
            stripePriceId: item.stripePriceId,
            kind: lookup.kind === 'PLAN' ? 'BASE_PLAN' : 'ADDON',
            planId: lookup.kind === 'PLAN' ? lookup.catalogId : null,
            addOnId: lookup.kind === 'ADDON' ? lookup.catalogId : null,
            quantity: item.quantity,
            isActive: item.isActive,
          },
          update: {
            stripePriceId: item.stripePriceId,
            kind: lookup.kind === 'PLAN' ? 'BASE_PLAN' : 'ADDON',
            planId: lookup.kind === 'PLAN' ? lookup.catalogId : null,
            addOnId: lookup.kind === 'ADDON' ? lookup.catalogId : null,
            quantity: item.quantity,
            isActive: item.isActive,
          },
        });
      }
    });

    // Out of the transaction so cache invalidation can survive transient
    // Redis errors (we log + swallow).
    cachedInvalidations.push(...(await this.syncEntitlements(tenant.id, snap)));

    return {
      ok: true,
      subscriptionsAffected: 1,
      cacheInvalidations: cachedInvalidations,
    };
  }

  // ---------------------------------------------------------------------
  // Subscription deletion
  // ---------------------------------------------------------------------

  /**
   * Handle `customer.subscription.deleted`. Marks the local snapshot as
   * cancelled, sets `expiresAt` on the corresponding TenantEntitlement,
   * and clears the add-ons. If the tenant has no remaining entitlement
   * we replace it with the FREE plan so the customer keeps read access.
   */
  async applySubscriptionDeleted(subscription: unknown): Promise<SyncResult> {
    const snap = this.parseSubscriptionSnapshot(subscription);
    const tenant = await this.findTenantByStripeCustomer(snap.stripeCustomerId);
    if (!tenant) {
      return { ok: false, subscriptionsAffected: 0, cacheInvalidations: [] };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stripeSubscription.update({
        where: { tenantId: tenant.id },
        data: {
          status: mapStripeStatus(snap.status),
          cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
          cancelAt: snap.cancelAt,
          canceledAt: snap.canceledAt ?? new Date(),
          updatedAt: new Date(),
        },
      });
      await tx.stripeSubscriptionItem.updateMany({
        where: { subscription: { tenantId: tenant.id } },
        data: { isActive: false, updatedAt: new Date() },
      });

      // Replace current entitlement with FREE plan so the customer still
      // has read access but loses every premium feature.
      const freePlan = await tx.plan.findFirst({
        where: { tier: 'FREE', isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      if (freePlan) {
        await tx.tenantEntitlement.create({
          data: {
            tenantId: tenant.id,
            planId: freePlan.id,
            effectiveAt: snap.currentPeriodEnd ?? new Date(),
            expiresAt: null,
          },
        });
        await tx.tenantEntitlementAddOn.deleteMany({
          where: { entitlement: { tenantId: tenant.id } },
        });
      }
    });

    const invalidated = await this.invalidateEntitlements(tenant.id);
    return {
      ok: true,
      subscriptionsAffected: 1,
      cacheInvalidations: invalidated,
    };
  }

  // ---------------------------------------------------------------------
  // Invoice lifecycle — audit log only
  // ---------------------------------------------------------------------

  /**
   * Record invoice paid/failed transitions for audit. We don't change
   * tenant entitlements here because Stripe's status is already mirrored
   * by the `customer.subscription.updated` event we receive within the
   * same webhook batch.
   */
  async applyInvoiceLifecycle(
    invoice: unknown,
    type: 'invoice.paid' | 'invoice.payment_failed',
  ): Promise<void> {
    const obj = (invoice ?? {}) as {
      id?: string;
      amount_due?: number;
      amount_paid?: number;
      customer?: string;
      subscription?: string;
    };
    const customerId = obj.customer;
    if (!customerId) {
      this.logger.warn(`Invoice ${obj.id ?? 'unknown'} has no customer; cannot audit.`);
      return;
    }
    const tenant = await this.findTenantByStripeCustomer(customerId);
    if (!tenant) return;

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: 'stripe-webhook',
        action: 'CREATE',
        resource: 'invoice',
        resourceId: obj.id ?? 'unknown',
        after: {
          stripeEvent: type,
          amountDue: obj.amount_due ?? null,
          amountPaid: obj.amount_paid ?? null,
          subscriptionId: obj.subscription ?? null,
        },
        ipAddress: null,
        userAgent: 'stripe-webhook',
      },
    });
  }

  // ---------------------------------------------------------------------
  // Internal: entitlement reconciliation
  // ---------------------------------------------------------------------

  private async syncEntitlements(
    tenantId: string,
    snap: StripeSubscriptionSnapshot,
  ): Promise<string[]> {
    const invalidated: string[] = [];
    const isEntitled = this.isCurrentlyEntitled(snap);
    if (!isEntitled) {
      // Subscription is not active (past_due, unpaid, etc.) — leave the
      // entitlement in place but invalidate the cache so the guard sees
      // the current Stripe status.
      invalidated.push(...(await this.invalidateEntitlements(tenantId)));
      return invalidated;
    }

    const items = await this.prisma.stripeSubscriptionItem.findMany({
      where: { subscription: { tenantId }, isActive: true },
      include: { plan: true, addOn: true },
    });
    const planItem = items.find((i) => i.kind === 'BASE_PLAN' && i.plan);
    const addonItems = items.filter((i) => i.kind === 'ADDON' && i.addOnId);

    if (!planItem || !planItem.planId) {
      this.logger.warn(
        `Tenant=${tenantId} subscription has no resolvable base plan item — entitlement not updated.`,
      );
      invalidated.push(...(await this.invalidateEntitlements(tenantId)));
      return invalidated;
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenantEntitlement.findFirst({
        where: { tenantId },
        orderBy: { effectiveAt: 'desc' },
      });

      const base = {
        tenantId,
        planId: planItem.planId!,
        effectiveAt: snap.currentPeriodStart ?? new Date(),
        expiresAt: null,
      } satisfies Partial<TenantEntitlement>;

      let entitlementId: string;
      if (existing) {
        const updated = await tx.tenantEntitlement.update({
          where: { id: existing.id },
          data: base,
        });
        entitlementId = updated.id;
      } else {
        const created = await tx.tenantEntitlement.create({
          data: {
            tenantId,
            planId: planItem.planId!,
            effectiveAt: base.effectiveAt ?? new Date(),
            expiresAt: null,
          },
        });
        entitlementId = created.id;
      }

      // Replace the add-on set.
      await tx.tenantEntitlementAddOn.deleteMany({
        where: { entitlementId },
      });
      for (const item of addonItems) {
        if (!item.addOnId) continue;
        await tx.tenantEntitlementAddOn.create({
          data: {
            entitlementId,
            addOnId: item.addOnId,
          },
        });
      }
    });

    invalidated.push(...(await this.invalidateEntitlements(tenantId)));
    return invalidated;
  }

  private async invalidateEntitlements(tenantId: string): Promise<string[]> {
    const key = `${ENTITLEMENTS_CACHE_PREFIX}${tenantId}`;
    try {
      await this.redis.del(key);
      return [key];
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate entitlements cache ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private isCurrentlyEntitled(snap: StripeSubscriptionSnapshot): boolean {
    const mapped = mapStripeStatus(snap.status);
    if ((ACTIVE_STRIPE_STATUSES as readonly string[]).includes(mapped)) {
      // Even within an active status, if the period has been cancelled and
      // the end has already passed, the sub is no longer usable.
      if (snap.canceledAt && snap.currentPeriodEnd) {
        const elapsed = (snap.canceledAt.getTime() - snap.currentPeriodEnd.getTime()) / 1000;
        if (elapsed > SUBSCRIPTION_DEAD_GRACE_SECONDS) return false;
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Parsing & lookups
  // ---------------------------------------------------------------------

  private parseSubscriptionSnapshot(raw: unknown): StripeSubscriptionSnapshot {
    const obj = (raw ?? {}) as {
      id?: string;
      customer?: string | { id?: string };
      status?: string;
      current_period_start?: number;
      current_period_end?: number;
      cancel_at_period_end?: boolean;
      cancel_at?: number | null;
      canceled_at?: number | null;
      trial_start?: number | null;
      trial_end?: number | null;
      items?: {
        data?: Array<{
          id?: string;
          price?: { id?: string };
          quantity?: number;
        }>;
      };
      livemode?: boolean;
    };

    const stripeCustomerId =
      typeof obj.customer === 'string'
        ? obj.customer
        : obj.customer?.id ?? '';

    const items = (obj.items?.data ?? []).flatMap((item) => {
      if (!item.id || !item.price?.id) return [];
      return [
        {
          stripeSubscriptionItemId: item.id,
          stripePriceId: item.price.id,
          quantity: item.quantity ?? 1,
          isActive: true,
        },
      ];
    });

    return {
      stripeSubscriptionId: obj.id ?? '',
      stripeCustomerId,
      status: mapStripeStatus(obj.status ?? 'incomplete'),
      currentPeriodStart: this.toDate(obj.current_period_start),
      currentPeriodEnd: this.toDate(obj.current_period_end),
      cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      cancelAt: this.toDateOrNull(obj.cancel_at),
      canceledAt: this.toDateOrNull(obj.canceled_at),
      trialStart: this.toDateOrNull(obj.trial_start),
      trialEnd: this.toDateOrNull(obj.trial_end),
      items,
      livemode: Boolean(obj.livemode),
    };
  }

  private toDate(value: number | undefined): Date {
    if (typeof value !== 'number' || !Number.isFinite(value)) return new Date();
    return new Date(value * 1000);
  }

  private toDateOrNull(value: number | null | undefined): Date | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return new Date(value * 1000);
  }

  private stripeSubscriptionCreate(tenantId: string, snap: StripeSubscriptionSnapshot) {
    return {
      tenantId,
      stripeSubscriptionId: snap.stripeSubscriptionId,
      status: mapStripeStatus(snap.status),
      currentPeriodStart: snap.currentPeriodStart,
      currentPeriodEnd: snap.currentPeriodEnd,
      cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
      cancelAt: snap.cancelAt,
      canceledAt: snap.canceledAt,
      trialStart: snap.trialStart,
      trialEnd: snap.trialEnd,
    };
  }

  private stripeSubscriptionUpdate(snap: StripeSubscriptionSnapshot) {
    return {
      stripeSubscriptionId: snap.stripeSubscriptionId,
      status: mapStripeStatus(snap.status),
      currentPeriodStart: snap.currentPeriodStart,
      currentPeriodEnd: snap.currentPeriodEnd,
      cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
      cancelAt: snap.cancelAt,
      canceledAt: snap.canceledAt,
      trialStart: snap.trialStart,
      trialEnd: snap.trialEnd,
      updatedAt: new Date(),
    };
  }

  private async findTenantByStripeCustomer(stripeCustomerId: string) {
    if (!stripeCustomerId) return null;
    return this.prisma.stripeCustomer.findFirst({
      where: { stripeCustomerId },
      include: { tenant: true },
    }).then((row) => row?.tenant ?? null);
  }

  private receipt(event: StripeWebhookEvent): WebhookEventReceipt {
    return {
      stripeEventId: event.stripeEventId,
      type: event.type,
      status: event.status,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString(),
      errorMessage: event.errorMessage ?? undefined,
    };
  }

  /**
   * Static helper used by tests + admin scripts to summarise terminal
   * statuses (currently unused at runtime but kept here so behaviour stays
   * in one place).
   */
  static isTerminal(snap: StripeSubscriptionSnapshot): boolean {
    return (TERMINAL_STRIPE_STATUSES as readonly string[]).includes(
      mapStripeStatus(snap.status),
    );
  }
}
