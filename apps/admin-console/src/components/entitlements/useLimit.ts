'use client';

/**
 * useLimit — read a numeric entitlement cap (P3.2).
 *
 *   const maxUsers = useLimit('limit.maxUsers');
 *   const usage = useLimitUsage('limit.maxUsers');
 *
 * Returns:
 *   - `null` for "unlimited" (ENTERPRISE plan) OR while loading.
 *   - `number` for the cap.
 *
 * Why null-on-loading? The FE renders "∞ users" while the payload is
 * in flight — that's a strictly safer default than "0 users", which
 * would hard-block forms that haven't yet hydrated.
 *
 * Usage is exposed via a separate hook (`useLimitUsage`) so a UI can
 * render "12 / 25" progress bars without us having to change the
 * primitive. The two hooks share the same provider so there's no
 * extra fetch.
 */

import { useEntitlements } from './EntitlementsProvider';
import type { LimitFeatureKey } from '@omyxia/shared-types';

export type UseLimitKey = LimitFeatureKey | (string & {});

export interface UseLimitResult {
  /** `null` for unlimited or while loading. `number` for the cap. */
  limit: number | null;
  /** True once the provider has finished its first load. */
  hasLoaded: boolean;
}

export function useLimit(key: UseLimitKey): number | null {
  return useLimitWithMeta(key).limit;
}

export function useLimitWithMeta(key: UseLimitKey): UseLimitResult {
  const { state } = useEntitlements();
  const hasLoaded = state.kind === 'ok' || state.kind === 'error';
  if (state.kind !== 'ok') {
    return { limit: null, hasLoaded };
  }
  const raw = state.entitlements.limits?.[key as LimitFeatureKey];
  // Defensive: if the BE ever sends a non-null non-number we treat
  // it as unlimited rather than 0 (don't want to silently hard-block
  // users on a malformed payload).
  if (raw === null || raw === undefined) {
    return { limit: null, hasLoaded };
  }
  if (typeof raw !== 'number') {
    return { limit: null, hasLoaded };
  }
  return { limit: raw, hasLoaded };
}

/**
 * useLimitUsage — current usage counter for a limit.
 *
 * Returns `null` while loading, or when the BE doesn't ship a usage
 * counter for that key. Always a non-negative integer when present.
 */
export function useLimitUsage(key: UseLimitKey): number | null {
  const { state } = useEntitlements();
  if (state.kind !== 'ok') return null;
  const usage = state.entitlements.usage?.[key as LimitFeatureKey];
  if (typeof usage !== 'number') return null;
  if (usage < 0) return null;
  return usage;
}

/**
 * useLimitStatus — convenience hook that combines limit + usage
 * for "12 / 25 users" badges.
 *
 * Returns:
 *   - `kind: 'unlimited'` when the limit is `null` (ENTERPRISE).
 *   - `kind: 'ok'` when usage < limit.
 *   - `kind: 'near'` when usage >= 80% of limit.
 *   - `kind: 'full'` when usage >= limit (form should hard-stop).
 *   - `kind: 'loading'` when the provider hasn't hydrated yet.
 *   - `kind: 'error'` when the fetch failed.
 */
export type UseLimitStatusResult =
  | { kind: 'loading' }
  | { kind: 'error'; hasLoaded: true }
  | {
      kind: 'unlimited';
      limit: null;
      usage: number | null;
    }
  | {
      kind: 'ok' | 'near' | 'full';
      limit: number;
      usage: number | null;
      percent: number;
    };

export function useLimitStatus(key: UseLimitKey): UseLimitStatusResult {
  const { state } = useEntitlements();
  if (state.kind === 'idle' || state.kind === 'loading') {
    return { kind: 'loading' };
  }
  if (state.kind === 'error') {
    return { kind: 'error', hasLoaded: true };
  }
  const limitRaw = state.entitlements.limits?.[key as LimitFeatureKey];
  if (limitRaw === null || limitRaw === undefined) {
    return {
      kind: 'unlimited',
      limit: null,
      usage: state.entitlements.usage?.[key as LimitFeatureKey] ?? null,
    };
  }
  if (typeof limitRaw !== 'number') {
    return { kind: 'unlimited', limit: null, usage: null };
  }
  const usageRaw = state.entitlements.usage?.[key as LimitFeatureKey];
  const usage =
    typeof usageRaw === 'number' && usageRaw >= 0 ? usageRaw : 0;
  const percent = Math.min(100, Math.round((usage / limitRaw) * 100));
  if (usage >= limitRaw) return { kind: 'full', limit: limitRaw, usage, percent };
  if (percent >= 80) return { kind: 'near', limit: limitRaw, usage, percent };
  return { kind: 'ok', limit: limitRaw, usage, percent };
}