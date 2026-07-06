/**
 * omyxia v2.0.0 P4.1 — Stripe-related constants.
 *
 * Anything environment-driven (secret keys, webhook secret, fallback price
 * IDs, return URLs) lives here so the module's behaviour is easy to audit
 * in a single file. The literal strings are env keys, not values — values
 * are read at runtime from `process.env` via `StripeModule`.
 */

/** Env var that holds the Stripe secret key (e.g. `sk_live_...`). */
export const STRIPE_SECRET_KEY_ENV = 'STRIPE_SECRET_KEY';

/** Env var that holds the Stripe webhook signing secret (`whsec_...`). */
export const STRIPE_WEBHOOK_SECRET_ENV = 'STRIPE_WEBHOOK_SECRET';

/** Stripe SDK version pin (used by the bundled SDK). */
export const STRIPE_API_VERSION = '2025-09-30.clover' as const;

/** Header that carries the Stripe webhook signature. */
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/**
 * Default return URL fallback when an explicit `return_url` is not supplied.
 * Matches the admin-console origin configured in P2.1.
 */
export const DEFAULT_RETURN_URL = 'https://admin.omyxia.app/billing';

/**
 * Default success / cancel URL used by the Checkout flow.
 */
export const DEFAULT_CHECKOUT_RETURN_URL = 'https://app.omyxia.app/post-checkout';

/**
 * Subscription update grace period — when a tenant's `currentPeriodEnd` is
 * more than this many seconds in the past, we treat the subscription as
 * effectively dead for entitlement purposes (Stripe keeps canceled subs
 * for ~24h).
 */
export const SUBSCRIPTION_DEAD_GRACE_SECONDS = 60 * 60 * 24; // 24h

/**
 * Webhook event types the API actually reacts to. Anything else is captured
 * in `StripeWebhookEvent` and marked `SKIPPED` so we have an audit trail
 * without processing them. Kept alphabetised for grep.
 */
export const HANDLED_WEBHOOK_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
] as const;

export type HandledWebhookEvent = (typeof HANDLED_WEBHOOK_EVENTS)[number];
