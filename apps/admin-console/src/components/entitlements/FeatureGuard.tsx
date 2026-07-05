'use client';

/**
 * FeatureGuard — client-side route guard based on entitlements (P3.2).
 *
 *   <FeatureGuard feature="admin.plans" featureLabel="Plans">
 *     <PlansPageContents />
 *   </FeatureGuard>
 *
 * Behaviour matrix:
 *
 *   loading                              | render `fallback` (or null)
 *   loaded, feature === true             | render `children`
 *   loaded, feature === false            | redirect to /upgrade?feature=…&from=…
 *   provider errored                     | redirect to /upgrade (defensive — fail closed)
 *   feature string is missing/empty      | render `children` (no-op guard)
 *
 * Why client-side only?
 *   - We don't know the entitlements until the provider hydrates, so
 *     the middleware can't pre-reject on the Edge.
 *   - Direct URL access (e.g. pasting `/plans` into the address bar)
 *     still hits the page, the provider fetches, and FeatureGuard
 *     redirects on the very first render that has the answer. The
 *     user sees a one-frame flash — acceptable given we already pay
 *     this cost on every navigation (the page is client-rendered).
 *   - The middleware STILL re-verifies the JWT — this is a
 *     UX gate, not a security gate. The BE is the source of truth
 *     and will 403 if the admin somehow reaches a gated API call.
 *
 * The redirect target is `/upgrade?feature=<key>&from=<currentPath>`.
 * The /upgrade page reads these query params and renders an
 * `UpgradeHint` with the right copy + recommended-plan chip.
 *
 * `<Entitled>` is a non-redirecting variant for inline conditional
 * rendering (e.g. hide a button, show a "Locked" badge).
 */

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useFeatureWithMeta, useFeature } from './useFeature';
import { useEntitlements } from './EntitlementsProvider';
import type { FeatureKey } from '@omyxia/shared-types';

export interface FeatureGuardProps {
  /**
   * The feature key to gate on. Accepts any of the `module.*`,
   * `limit.*`, or `admin.*` shapes. Empty string is a no-op (always
   * renders children).
   */
  feature: FeatureKey | string;
  /** Human-readable label — used in the upgrade CTA copy. */
  featureLabel?: string;
  /**
   * Optional fallback rendered while entitlements are loading or
   * while the redirect hasn't happened yet. Defaults to `null`
   * (blank page) which is fine because the page itself usually has
   * a loading state in the layout.
   */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Build the `/upgrade` query string for a feature guard redirect.
 * Exported so tests + the upgrade page can share the contract.
 */
export function navigateToUpgrade(
  feature: string,
  from: string | null,
  featureLabel?: string
): string {
  const params = new URLSearchParams();
  if (feature) params.set('feature', feature);
  if (featureLabel) params.set('label', featureLabel);
  if (from) params.set('from', from);
  return `/upgrade${params.toString() ? `?${params.toString()}` : ''}`;
}

export function FeatureGuard({
  feature,
  featureLabel,
  fallback = null,
  children,
}: FeatureGuardProps) {
  const { enabled, hasLoaded } = useFeatureWithMeta(feature);
  const { state } = useEntitlements();
  const router = useRouter();
  const pathname = usePathname();
  const redirectedRef = React.useRef(false);

  // No-op guard when feature is empty.
  const isGuarded = typeof feature === 'string' && feature.length > 0;

  React.useEffect(() => {
    if (!isGuarded) return;
    if (enabled) {
      redirectedRef.current = false;
      return;
    }
    // Wait until the provider has finished its first load before
    // deciding to redirect. Without this gate we'd redirect on the
    // very first paint (when `enabled` is still the default `false`
    // for "loading"), even though the user has the right plan. The
    // `~400ms` it takes to resolve the fetch then loops us back to
    // the original page — jarring UX. By waiting for `hasLoaded` we
    // only redirect after the entitlements payload is in hand.
    if (!hasLoaded) return;
    // Provider errored → fail closed (redirect). Better UX than a
    // blank page that doesn't recover.
    if (state.kind !== 'ok' && state.kind !== 'loading') {
      // fall through to the redirect below
    } else if (state.kind === 'loading') {
      return;
    }
    // Don't loop if we already redirected this render pass.
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    const target = navigateToUpgrade(
      feature,
      pathname ?? null,
      featureLabel
    );
    router.replace(target);
  }, [
    enabled,
    hasLoaded,
    state.kind,
    feature,
    featureLabel,
    isGuarded,
    pathname,
    router,
  ]);

  if (!isGuarded) return <>{children}</>;
  if (!enabled) {
    // Loading OR redirecting — render the fallback (default blank).
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// <Entitled> — non-redirecting variant for inline conditional rendering.
//
//   <Entitled feature="admin.audit" fallback={<LockedBadge />}>
//     <AuditLink />
//   </Entitled>
// ---------------------------------------------------------------------------

export interface EntitledProps {
  feature: FeatureKey | string;
  /** Optional fallback shown while loading OR when the feature is off. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function Entitled({ feature, fallback = null, children }: EntitledProps) {
  const enabled = useFeature(feature);
  if (!feature) return <>{children}</>;
  return <>{enabled ? children : fallback}</>;
}