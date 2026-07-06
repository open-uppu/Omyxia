/**
 * omyxia v2.0.0 P4.1 — Proration behaviour helpers.
 *
 * Stripe lets you choose how subscription item updates affect the
 * upcoming invoice. The choice is a small UX vs. accounting tradeoff:
 *
 *   * `create_prorations`   — credit/debit the customer for the remainder
 *                             of the period. Default and what most B2B
 *                             SaaS wants.
 *   * `none`                — no proration; useful for grandfathering a
 *                             tenant or for compliance-only changes.
 *   * `always_invoice`      — close out the current period immediately
 *                             and bill the customer for both line items.
 *                             Used for hard-cutover migrations.
 *
 * We expose the choice as a small enum so the controller DTO + service
 * code + tests can all reference the same vocabulary. Keeping it in its
 * own file avoids circular imports between the service and the catalog.
 */

export const PRORATION_BEHAVIORS = ['create_prorations', 'none', 'always_invoice'] as const;

export type ProrationBehavior = (typeof PRORATION_BEHAVIORS)[number];

export function isProrationBehavior(value: unknown): value is ProrationBehavior {
  return typeof value === 'string' && (PRORATION_BEHAVIORS as readonly string[]).includes(value);
}

/** Default used by `POST /api/billing/subscription` if not specified. */
export const DEFAULT_PRORATION_BEHAVIOR: ProrationBehavior = 'create_prorations';
