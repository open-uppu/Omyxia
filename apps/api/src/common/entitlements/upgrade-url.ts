/**
 * Upgrade URL builder.
 *
 * The FE `/upgrade` modal reads:
 *
 *   - `feature`     → renders "X requires the Pro plan"
 *   - `from`        → renders "Back to dashboard" CTA
 *   - `currentPlan` → renders plan chip
 *   - `recommendedPlan` → renders "Upgrade to Enterprise" CTA
 *
 * Returns an absolute URL when `baseUrl` is provided, else a path.
 * We keep it dependency-free (no env reads) so unit tests don't need a
 * Nest test harness.
 */
import type { FeatureKey } from './feature-catalog';
import { FEATURE_RECOMMENDED_PLAN } from './feature-catalog';

export interface BuildUpgradeUrlOptions {
  /** Feature key that triggered the redirect. */
  feature: FeatureKey;
  /** Plan slug this tenant is currently on. */
  currentPlan: string;
  /** Path the user was trying to access (for the "Back" CTA). */
  from?: string;
  /** Base URL of the admin console. Default: process.env.APP_URL. */
  baseUrl?: string;
}

/**
 * Build the URL to redirect a denied user to.
 *
 *   `https://admin.omyxia.app/upgrade?feature=module.crm&plan=PRO&from=%2Fcrm%2Fpipelines`
 *
 * Returns the path form when `baseUrl` is omitted (handy in tests).
 */
export function buildUpgradeUrl(opts: BuildUpgradeUrlOptions): string {
  const base =
    opts.baseUrl ??
    process.env.APP_URL ??
    process.env.ADMIN_CONSOLE_URL ??
    'https://admin.omyxia.app';

  const params = new URLSearchParams();
  params.set('feature', opts.feature);
  params.set('plan', opts.currentPlan);
  const recommended = FEATURE_RECOMMENDED_PLAN[opts.feature];
  if (recommended) params.set('recommendedPlan', recommended);
  if (opts.from) params.set('from', opts.from);

  // Strip trailing slash from base so we don't produce `//upgrade`.
  const trimmedBase = base.replace(/\/+$/, '');
  return `${trimmedBase}/upgrade?${params.toString()}`;
}
