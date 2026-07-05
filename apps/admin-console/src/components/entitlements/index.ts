/**
 * Barrel for the entitlements surface (P3.2).
 *
 * Public API:
 *
 *   - <EntitlementsProvider>          — context provider + fetcher
 *   - useEntitlements()                — read the full payload
 *   - useFeature(key) / useFeatureWithMeta(key)
 *   - useAnyFeature(keys)              — OR over a set
 *   - useLimit(key) / useLimitWithMeta(key)
 *   - useLimitUsage(key)               — current usage counter
 *   - useLimitStatus(key)              — ok / near / full / unlimited
 *   - <FeatureGuard feature=…>         — client-side route guard
 *   - <Entitled feature=…>             — inline conditional render
 *
 * See each module for the full contract.
 */

export { EntitlementsProvider, useEntitlements } from './EntitlementsProvider';
export type { EntitlementsContextValue, EntitlementsState } from './EntitlementsProvider';

export {
  useFeature,
  useFeatureWithMeta,
  useAnyFeature,
} from './useFeature';
export type { UseFeatureKey, UseFeatureResult } from './useFeature';

export {
  useLimit,
  useLimitWithMeta,
  useLimitUsage,
  useLimitStatus,
} from './useLimit';
export type { UseLimitKey, UseLimitResult, UseLimitStatusResult } from './useLimit';

export { FeatureGuard, Entitled, navigateToUpgrade } from './FeatureGuard';
export type { FeatureGuardProps, EntitledProps } from './FeatureGuard';