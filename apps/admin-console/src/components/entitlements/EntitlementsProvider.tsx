'use client';

/**
 * EntitlementsProvider — single source of truth for "what can this
 * admin do right now?" (P3.2).
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ <EntitlementsProvider>                                       │
 *   │   ├── <Sidebar />          reads NAV_ITEMS[].feature via     │
 *   │   │                        useFeature()                      │
 *   │   ├── <FeatureGuard>       redirects to /upgrade when        │
 *   │   │                        useFeature() === false            │
 *   │   ├── /upgrade page        reads useEntitlements()           │
 *   │   └── anywhere that needs  useLimit('hr.employees')         │
 *   │       a quota number                                         │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The provider:
 *   1. Fetches `GET /api/entitlements/me` once on mount.
 *   2. Re-fetches on a configurable cadence (default 5 min — same as
 *      `useDashboardMetrics`). Pause while document.hidden.
 *   3. Exposes `refresh()` for callers that need to force a re-read
 *      (e.g. right after a plan upgrade flow).
 *   4. Tracks state machine: idle → loading → ok | error.
 *
 * Failure modes:
 *   - 401: we silently drop the cookie and stay in `idle`. The
 *     middleware will bounce the user to /login on the next nav —
 *     we don't need to do anything fancy here.
 *   - 502 / network: we surface an `error` state but the hooks still
 *     default to `false` / `null` (defensive — see hook docs).
 *   - Loading: hooks default to `false` / `null` so a sidebar doesn't
 *     flash every item before the first paint.
 *
 * The provider NEVER throws. All state lives in a single context.
 */

import * as React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EntitlementsSchema,
  type Entitlements,
} from '@omyxia/shared-types';

export type EntitlementsState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous?: Entitlements }
  | { kind: 'ok'; entitlements: Entitlements }
  | { kind: 'error'; error: string; previous?: Entitlements };

export interface EntitlementsContextValue {
  /** Current state (see `EntitlementsState`). */
  state: EntitlementsState;
  /** Convenience accessor — undefined while not loaded. */
  entitlements: Entitlements | undefined;
  /** Force a re-fetch (e.g. after a plan upgrade). */
  refresh: () => Promise<void>;
  /**
   * Convenience flag — true once we've successfully fetched at least
   * once (used by tests to wait for hydration).
   */
  hasLoaded: boolean;
}

const EntitlementsContext = createContext<EntitlementsContextValue | null>(
  null
);

interface EntitlementsProviderProps {
  children: React.ReactNode;
  /**
   * Override the endpoint (tests + storybook). Defaults to
   * `/api/entitlements/me`.
   */
  endpoint?: string;
  /**
   * Refresh cadence in ms. Pass `0` to disable auto-refresh.
   * Default: 5 minutes.
   */
  refreshMs?: number;
  /**
   * Disable fetching entirely (useful for the upgrade page itself,
   * which wants to render a hint regardless of the live state).
   */
  disabled?: boolean;
}

const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

export function EntitlementsProvider({
  children,
  endpoint = '/api/entitlements/me',
  refreshMs = DEFAULT_REFRESH_MS,
  disabled = false,
}: EntitlementsProviderProps) {
  const [state, setState] = useState<EntitlementsState>({ kind: 'idle' });
  const inFlightRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return; // de-dupe concurrent fetches
    inFlightRef.current = true;
    setState((prev) =>
      prev.kind === 'ok'
        ? { kind: 'loading', previous: prev.entitlements }
        : { kind: 'loading' }
    );
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status === 401) {
        // Session expired — let the middleware redirect to /login.
        inFlightRef.current = false;
        setState({ kind: 'idle' });
        return;
      }
      if (!res.ok) {
        inFlightRef.current = false;
        setState((prev) => ({
          kind: 'error',
          error: `HTTP ${res.status}`,
          ...(prev.kind === 'ok' ? { previous: prev.entitlements } : {}),
        }));
        return;
      }
      const raw = (await res.json()) as unknown;
      const result = EntitlementsSchema.safeParse(raw);
      if (!result.success) {
        inFlightRef.current = false;
        setState((prev) => ({
          kind: 'error',
          error: 'Malformed entitlements payload',
          ...(prev.kind === 'ok' ? { previous: prev.entitlements } : {}),
        }));
        return;
      }
      inFlightRef.current = false;
      setState({ kind: 'ok', entitlements: result.data });
    } catch (err) {
      inFlightRef.current = false;
      setState((prev) => ({
        kind: 'error',
        error: err instanceof Error ? err.message : 'Network error',
        ...(prev.kind === 'ok' ? { previous: prev.entitlements } : {}),
      }));
    }
  }, [endpoint]);

  // Initial fetch + optional auto-refresh.
  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;
    void load();

    if (!refreshMs) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (document.visibilityState === 'hidden') {
        // Reschedule for when we come back; the visibilitychange
        // listener below handles that.
        return;
      }
      void load().finally(() => {
        timer = setTimeout(tick, refreshMs);
      });
    };
    timer = setTimeout(tick, refreshMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Refresh immediately on tab focus so a plan change made in
        // another tab is picked up.
        void load();
        if (timer) clearTimeout(timer);
        timer = setTimeout(tick, refreshMs);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, refreshMs, disabled]);

  const refresh = useCallback(() => load(), [load]);

  const value = useMemo<EntitlementsContextValue>(() => {
    return {
      state,
      entitlements: state.kind === 'ok' ? state.entitlements : undefined,
      refresh,
      hasLoaded: state.kind === 'ok' || state.kind === 'error',
    };
  }, [state, refresh]);

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
}

/**
 * useEntitlements — read the current `Entitlements` payload (or
 * `undefined` while loading).
 *
 * Most callers should use the narrower `useFeature` / `useLimit` hooks.
 * This lower-level hook is for code that needs the whole payload
 * (e.g. the `/upgrade` page rendering plan metadata).
 */
export function useEntitlements(): EntitlementsContextValue {
  const ctx = useContext(EntitlementsContext);
  if (ctx) return ctx;
  // Outside a provider → return a no-op "always loading" snapshot so
  // callers don't crash. This matches the defensive default the
  // hooks expose (useFeature → false, useLimit → null) — there's no
  // safe default for the full payload so we just signal "not ready".
  return {
    state: { kind: 'idle' },
    entitlements: undefined,
    refresh: async () => undefined,
    hasLoaded: false,
  };
}