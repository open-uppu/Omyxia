/**
 * omyxia v2.0.0 P4.1 — Stripe billing types (Domain ↔ Prisma ↔ Stripe SDK).
 *
 * The Stripe SDK comes with its own discriminated-union event types
 * (`Stripe.Event`, `Stripe.Subscription`, ...). We treat those as the
 * canonical wire format and only project the fields we actually persist
 * — keeping our DTOs small makes the webhook signature test simpler and
 * keeps us safe from accidental writes if Stripe adds new required fields.
 */

import type {
  PlanTier,
  StripeItemKind,
  StripeSubscriptionStatus,
  StripeWebhookStatus,
} from '@prisma/client';

/**
 * Subscribed Stripe subscription statuses that count as "currently entitled".
 * Mirrors Stripe's understanding of "the customer can use the service right
 * now". `past_due` and `paused` are intentionally excluded — the FE surface
 * should block premium features when these flags are present (P3.x).
 */
export const ACTIVE_STRIPE_STATUSES: ReadonlyArray<StripeSubscriptionStatus> = [
  'ACTIVE',
  'TRIALING',
] as const;

export const GRACE_STRIPE_STATUSES: ReadonlyArray<StripeSubscriptionStatus> = [
  'PAST_DUE',
  'PAUSED',
] as const;

export const TERMINAL_STRIPE_STATUSES: ReadonlyArray<StripeSubscriptionStatus> = [
  'CANCELED',
  'UNPAID',
  'INCOMPLETE_EXPIRED',
] as const;

/** Stripe's lowercase status → our enum. Centralised so we can grep. */
export function mapStripeStatus(rawStatus: string): StripeSubscriptionStatus {
  const normalised = rawStatus.toLowerCase();
  switch (normalised) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    case 'unpaid':
      return 'UNPAID';
    case 'incomplete':
      return 'INCOMPLETE';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    case 'paused':
      return 'PAUSED';
    default:
      // Unknown new statuses fall back to the most conservative enum value
      // (`INCOMPLETE`) so we don't accidentally grant access. An alert in
      // `EntitlementsSyncService` will surface this for triage.
      return 'INCOMPLETE';
  }
}

/** Stripe-item kind discriminator used by webhook sync. */
export type WebhookItemKind = StripeItemKind;

/**
 * Projection of a Stripe subscription item we keep in memory while
 * computing the entitlement diff. We pick the smallest subset of fields
 * needed for the sync to map plan ↔ addon ↔ price.
 */
export interface StripeItemSnapshot {
  stripeSubscriptionItemId: string;
  stripePriceId: string;
  quantity: number;
  /** `true` when the item is currently in the subscription's items list. */
  isActive: boolean;
}

/**
 * Compact subscription projection kept in memory during sync. Lives in
 * this file (not Prisma) because the rest of the module only ever works
 * with this shape — never full `Stripe.Subscription`.
 */
export interface StripeSubscriptionSnapshot {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: StripeSubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  canceledAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  items: StripeItemSnapshot[];
  livemode: boolean;
}

/**
 * Plan ↔ Add-on tier relationship used by entitlements sync to decide
 * which catalog row a given subscription item represents.
 */
export interface CatalogLookupResult {
  /** Type of catalog row that owns this stripe price id. */
  kind: 'PLAN' | 'ADDON';
  /** Cuid of the catalog row. */
  catalogId: string;
  /** Tier the plan belongs to (only set when kind === 'PLAN'). */
  planTier?: PlanTier;
}

/** DTO for the `POST /api/billing/portal` response. */
export interface BillingPortalResult {
  url: string;
  returnUrl: string;
}

/** DTO for the `POST /api/billing/checkout` response. */
export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

/** DTO for `GET /api/billing/subscription` (the FE summary view). */
export interface BillingSummary {
  tenantId: string;
  hasCustomer: boolean;
  hasSubscription: boolean;
  status?: StripeSubscriptionStatus;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: string | null;
  items: BillingSummaryItem[];
  /** Effective Stripe plan tier (resolved from the active base-plan item). */
  planTier?: PlanTier | null;
}

export interface BillingSummaryItem {
  stripeSubscriptionItemId: string;
  stripePriceId: string;
  kind: StripeItemKind;
  quantity: number;
  isActive: boolean;
  catalogName?: string;
  catalogSlug?: string;
}

/** Simple shape used in logs and admin views. */
export interface WebhookEventReceipt {
  stripeEventId: string;
  type: string;
  status: StripeWebhookStatus;
  receivedAt: string;
  processedAt?: string;
  errorMessage?: string;
}
