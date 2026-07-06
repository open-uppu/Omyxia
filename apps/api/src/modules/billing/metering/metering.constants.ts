/**
 * omyxia v2.0.0 P4.2 — Usage-metering constants.
 *
 * Anything environment-driven (Stripe metered price IDs, retention days,
 * cron expressions, idempotency window) lives here so the module's
 * behaviour is easy to audit in a single file. The literal strings are
 * env keys, not values — values are read at runtime from `process.env`.
 *
 * The metering module is *test-mode aware*: when `STRIPE_SECRET_KEY` is
 * empty (or `STRIPE_TEST_MODE=true`) the StripeMeteringService writes to
 * a deterministic in-memory recorder so the cron + admin endpoints can be
 * exercised end-to-end without network access. The same recorder is used
 * by the unit tests.
 */

import type { UsageMeter } from '@prisma/client';

// -------------------------------------------------------------------------
// Retention
// -------------------------------------------------------------------------

/** How long raw events stay in `TenantUsageEvent` after aggregation. */
export const USAGE_EVENT_RETENTION_DAYS = 90;

/**
 * How long a daily rollup stays before re-aggregation is allowed. This is
 * a safety floor — the daily cron should always be authoritative. A non-
 * zero floor prevents two concurrent cron runs from racing on the same
 * day. Tests can override with `USAGE_DAILY_LOCK_MINUTES=0`.
 */
export const USAGE_DAILY_LOCK_MINUTES = 5;

/** Default overage currency (matches Stripe API expectations). */
export const DEFAULT_OVERAGE_CURRENCY = 'usd';

// -------------------------------------------------------------------------
// Cron schedules
// -------------------------------------------------------------------------

/**
 * Cron expression for the **daily aggregation** job. Runs at 00:15 UTC so
 * the previous day's events are always present. (Cron format:
 * `<minute> <hour> <day> <month> <dayOfWeek>`.)
 */
export const DAILY_AGGREGATION_CRON = '15 0 * * *';

/**
 * Cron expression for the **monthly usage reporting** job. Runs at 02:00
 * UTC on the 2nd day of each month so day 1 (which is sometimes a partial
 * day for new tenants) is excluded. Cron format: minute hour day month dow.
 *
 * Stripe's billing cycle closes at the start of each period, so reporting
 * on day 2 of the following month lines up with the invoice that Stripe
 * generates for the *previous* billing period.
 */
export const MONTHLY_REPORTING_CRON = '0 2 2 * *';

/**
 * Cron expression for the **overage invoice** job. Runs at 03:00 UTC on
 * the 2nd day of each month — after the monthly reporting so we know
 * which tenants crossed their included quota.
 */
export const OVERAGE_INVOICING_CRON = '0 3 2 * *';

/**
 * Cron expression for the **event retention** job. Runs daily at 01:00
 * UTC to prune `TenantUsageEvent` rows older than
 * `USAGE_EVENT_RETENTION_DAYS` that have already been aggregated.
 */
export const EVENT_RETENTION_CRON = '0 1 * * *';

// -------------------------------------------------------------------------
// Env vars — Stripe price IDs for metered billing (dev/CI fallback)
// -------------------------------------------------------------------------

/**
 * Stripe price ID for the storage metered item. In production this is
 * sourced from `MeteredSubscriptionItem.stripeMeteredPriceId` once the
 * catalog is wired. The env var is a fallback for test mode + dev so
 * the cron can be exercised before the catalog is populated.
 */
export const STRIPE_PRICE_STORAGE_METERED_ENV = 'STRIPE_PRICE_STORAGE_METERED';

/** Stripe price ID for the API-call metered item. */
export const STRIPE_PRICE_API_CALLS_METERED_ENV = 'STRIPE_PRICE_API_CALLS_METERED';

/** Stripe price ID for the active-user metered item. */
export const STRIPE_PRICE_ACTIVE_USERS_METERED_ENV = 'STRIPE_PRICE_ACTIVE_USERS_METERED';

// -------------------------------------------------------------------------
// Stripe idempotency keys
// -------------------------------------------------------------------------

/** Redis key prefix for the daily-rollup advisory lock. */
export const DAILY_LOCK_REDIS_KEY_PREFIX = 'metering:daily-lock:v1:';

/** Redis key prefix for the monthly-report advisory lock. */
export const MONTHLY_LOCK_REDIS_KEY_PREFIX = 'metering:monthly-lock:v1:';

/** Redis key prefix for the overage-invoice advisory lock. */
export const OVERAGE_LOCK_REDIS_KEY_PREFIX = 'metering:overage-lock:v1:';

// -------------------------------------------------------------------------
// Stripe metering limits
// -------------------------------------------------------------------------

/**
 * Maximum number of times the monthly cron will retry a single tenant
 * before giving up and marking the report `FAILED`. The cron is reentrant,
 * so on the next run failed reports are retried automatically up to
 * `MAX_REPORT_ATTEMPTS`.
 */
export const MAX_REPORT_ATTEMPTS = 5;

/** Same as MAX_REPORT_ATTEMPTS but for overage invoice items. */
export const MAX_OVERAGE_ATTEMPTS = 5;

// -------------------------------------------------------------------------
// Metering constants — meters
// -------------------------------------------------------------------------

/** All three meters in a stable, alphabetised order. */
export const ALL_USAGE_METERS: ReadonlyArray<UsageMeter> = [
  'ACTIVE_USERS',
  'API_CALL_COUNT',
  'STORAGE_GB_HOURS',
] as const;

/** Default reporting unit label per meter — used in logs + admin UI. */
export const USAGE_METER_UNITS: Readonly<Record<UsageMeter, string>> = Object.freeze({
  STORAGE_GB_HOURS: 'GB-hour',
  API_CALL_COUNT: 'call',
  ACTIVE_USERS: 'user',
});

/**
 * How long the metering module keeps an idempotency window after a usage
 * event write. Two events with the same idempotency key + meter within
 * this window are de-duplicated. Defaults to 1 hour.
 */
export const EVENT_IDEMPOTENCY_WINDOW_MINUTES = 60;