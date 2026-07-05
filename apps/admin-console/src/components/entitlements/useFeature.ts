'use client';

/**
 * useFeature — read a boolean entitlement flag (P3.2).
 *
 *   const canCrm = useFeature('module.crm');
 *   if (!canCrm) redirect to /upgrade;
 *
 * Defaults:
 *   - Returns `false` until the entitlements payload has loaded.
 *     This is the SAFEST default — never accidentally grant access
 *     because the payload was missing a key, was still loading, or
 *     the provider isn't mounted.
 *   - Returns `false` for unknown keys (defensive).
 *   - Returns `false` when the entitlement fetch errored.
 *
 * The companion `useFeatureWithMeta` hook exposes the full
 * `Entitlements` payload alongside the boolean — used by the sidebar
 * to show a "Locked" badge with the upgrade hint.
 */

import { useEntitlements } from './EntitlementsProvider';
import type {
  AdminFeatureKey,
  FeatureKey,
  LimitFeatureKey,
  ModuleFeatureKey,
} from '@omyxia/shared-types';

export type UseFeatureKey =
  | ModuleFeatureKey
  | LimitFeatureKey
  | AdminFeatureKey
  | (string & {});

export interface UseFeatureResult {
  /** Resolved boolean — see defaults above. */
  enabled: boolean;
  /** True once the provider has finished its first load (ok or error). */
  hasLoaded: boolean;
  /** True while the first load is in flight (or refreshing). */
  isLoading: boolean;
}

export function useFeature(key: UseFeatureKey): boolean {
  return useFeatureWithMeta(key).enabled;
}

export function useFeatureWithMeta(key: UseFeatureKey): UseFeatureResult {
  const { state } = useEntitlements();
  const isLoading =
    state.kind === 'loading' ||
    state.kind === 'idle';
  const hasLoaded = state.kind === 'ok' || state.kind === 'error';
  if (state.kind !== 'ok') {
    return { enabled: false, hasLoaded, isLoading };
  }
  // Defensive: missing key OR non-boolean → false.
  const value = state.entitlements.features?.[key as FeatureKey];
  return {
    enabled: value === true,
    hasLoaded,
    isLoading,
  };
}

/**
 * useAnyFeature — convenience OR over a set of keys. Useful for the
 * sidebar to check "any module.* flag" without enumerating.
 */
export function useAnyFeature(keys: readonly UseFeatureKey[]): boolean {
  const { state } = useEntitlements();
  if (state.kind !== 'ok') return false;
  for (const key of keys) {
    if (state.entitlements.features?.[key as FeatureKey] === true) {
      return true;
    }
  }
  return false;
}