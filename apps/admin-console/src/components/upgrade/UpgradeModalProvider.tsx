'use client';

/**
 * UpgradeModalProvider — single source of truth for "is the upgrade
 * modal open right now?". Mounted once at the app shell (next to
 * AdminShell) so any client component in the tree can call
 * `useUpgradeModal()` to show / dismiss / track events.
 *
 * Three responsibilities:
 *
 *   1. **State** — owns the current `FeatureDenied` payload (or null
 *      when the modal is closed). Dismissing just clears it.
 *
 *   2. **HTTP bridge** — exposes `handleResponse(res)` that any
 *      fetch wrapper can call after an API call. If `res.status ===
 *      403` and the body matches `FeatureDeniedSchema`, the modal
 *      opens automatically. Otherwise the response is returned
 *      untouched.
 *
 *   3. **Dev-mode fallback** — when the BE doesn't return a real
 *      403 yet (e.g. `useTenantDetail` hooks see synthetic data),
 *      callers can still call `open(payload)` directly. Tests use
 *      this to drive the modal without spinning up a server.
 *
 * Impression tracking lives in `upgradeImpressionBus` (singleton)
 * so the modal can flush on `pagehide`. The provider just calls
 * `bus.push()` on user interactions.
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
  FeatureDeniedSchema,
  type FeatureDenied,
  type UpgradeImpression,
  type UpgradeImpressionKind,
} from '@omyxia/shared-types';
import { upgradeImpressionBus } from '@/lib/upgrade-modal-impressions';

interface OpenPayload {
  feature: FeatureDenied['feature'];
  featureLabel: FeatureDenied['featureLabel'];
  currentPlan: FeatureDenied['currentPlan'];
  recommendedPlan: FeatureDenied['recommendedPlan'];
  requiredAddOns?: FeatureDenied['requiredAddOns'];
  priceDeltaCents?: FeatureDenied['priceDeltaCents'];
  currency?: FeatureDenied['currency'];
  upgradeAdminEmail?: FeatureDenied['upgradeAdminEmail'];
  upgradeUrl?: FeatureDenied['upgradeUrl'];
  from?: FeatureDenied['from'];
}

interface UpgradeModalContextValue {
  /** Current payload (or null when modal is closed). */
  current: FeatureDenied | null;
  /** Imperatively open the modal — used by tests and direct callers. */
  open: (payload: OpenPayload) => void;
  /** Close + flush `dismissed` impression (if the modal was visible). */
  dismiss: () => void;
  /**
   * Inspect a Response and open the modal if it's a 403 with the
   * expected payload. Returns the response unchanged so callers can
   * keep chaining (e.g. `await fetch(...)`).
   */
  handleResponse: (res: Response) => Promise<Response>;
  /** True when the modal is currently visible. */
  isOpen: boolean;
  /** Track a CTA click — pushes a `cta_clicked` impression. */
  trackCtaClick: (target: 'mailto' | 'in_app_upgrade') => void;
}

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(null);

interface UpgradeModalProviderProps {
  children: React.ReactNode;
  /** Override the admin email (tests + storybook). */
  defaultAdminEmail?: string;
  /**
   * Disable the global `pagehide` beacon flush. Useful in jsdom where
   * `navigator.sendBeacon` is missing — without disabling, the test
   * would log a "beacon unavailable" warning.
   */
  disableBeacon?: boolean;
}

export function UpgradeModalProvider({
  children,
  defaultAdminEmail,
  disableBeacon,
}: UpgradeModalProviderProps) {
  const [current, setCurrent] = useState<FeatureDenied | null>(null);
  const shownAtRef = useRef<string | null>(null);

  const push = useCallback((event: {
    kind: UpgradeImpressionKind;
    ctaTarget?: 'mailto' | 'in_app_upgrade';
  }) => {
    if (!current) return;
    if (!shownAtRef.current) return; // never opened → nothing to track
    upgradeImpressionBus.push({
      kind: event.kind,
      feature: current.feature,
      shownAt: shownAtRef.current,
      at: new Date().toISOString(),
      currentPlan: current.currentPlan,
      recommendedPlan: current.recommendedPlan,
      ...(event.ctaTarget ? { ctaTarget: event.ctaTarget } : {}),
    });
  }, [current]);

  const open = useCallback((payload: OpenPayload) => {
    // Hydrate the optional fields with sensible defaults so callers
    // (especially tests) don't need to know about every column.
    const merged: FeatureDenied = {
      statusCode: 403,
      error: 'FEATURE_NOT_INCLUDED',
      feature: payload.feature,
      featureLabel: payload.featureLabel,
      currentPlan: payload.currentPlan,
      recommendedPlan: payload.recommendedPlan,
      requiredAddOns: payload.requiredAddOns ?? [],
      priceDeltaCents: payload.priceDeltaCents ?? null,
      currency: payload.currency ?? 'USD',
      upgradeAdminEmail: payload.upgradeAdminEmail ?? defaultAdminEmail ?? 'admin@omyxia.app',
      upgradeUrl: payload.upgradeUrl ?? '/upgrade',
      ...(payload.from ? { from: payload.from } : {}),
    };
    shownAtRef.current = new Date().toISOString();
    setCurrent(merged);
    // Defer the `shown` event to next tick so tests can attach an
    // effect listener before the event fires.
    queueMicrotask(() => {
      upgradeImpressionBus.push({
        kind: 'shown',
        feature: merged.feature,
        shownAt: shownAtRef.current!,
        at: new Date().toISOString(),
        currentPlan: merged.currentPlan,
        recommendedPlan: merged.recommendedPlan,
      });
    });
  }, [defaultAdminEmail]);

  const dismiss = useCallback(() => {
    if (current && shownAtRef.current) {
      push({ kind: 'dismissed' });
      // Best-effort flush — we don't want a 5-min delay on a quick
      // dismissal event.
      void upgradeImpressionBus.flush();
    }
    shownAtRef.current = null;
    setCurrent(null);
  }, [current, push]);

  const handleResponse = useCallback(async (res: Response): Promise<Response> => {
    if (res.status !== 403) return res;
    // Clone before reading so the caller's body stream stays intact.
    const cloned = res.clone();
    let parsed: unknown;
    try {
      parsed = await cloned.json();
    } catch {
      return res;
    }
    const result = FeatureDeniedSchema.safeParse(parsed);
    if (!result.success) {
      // Not our 403 shape — leave it for the caller to handle.
      return res;
    }
    open(result.data);
    return res;
  }, [open]);

  const trackCtaClick = useCallback((target: 'mailto' | 'in_app_upgrade') => {
    push({ kind: 'cta_clicked', ctaTarget: target });
    if (target === 'in_app_upgrade') {
      // plan_viewed is a separate event kind so the analytics sink
      // can distinguish "clicked CTA but didn't navigate" from
      // "actually opened the plans page". We carry the ctaTarget so
      // join queries can correlate.
      push({ kind: 'plan_viewed', ctaTarget: target });
    }
    void upgradeImpressionBus.flush();
  }, [push]);

  // Wire `pagehide` to a beacon flush so in-flight events survive
  // navigation. Skipped in test environments (jsdom has no
  // `navigator.sendBeacon`).
  useEffect(() => {
    if (disableBeacon) return;
    if (typeof window === 'undefined') return;
    const handler = () => {
      upgradeImpressionBus.beacon();
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [disableBeacon]);

  const value = useMemo<UpgradeModalContextValue>(() => ({
    current,
    open,
    dismiss,
    handleResponse,
    isOpen: current !== null,
    trackCtaClick,
  }), [current, open, dismiss, handleResponse, trackCtaClick]);

  return (
    <UpgradeModalContext.Provider value={value}>
      {children}
    </UpgradeModalContext.Provider>
  );
}

/** Consumer hook — throws if used outside the provider. */
export function useUpgradeModal(): UpgradeModalContextValue {
  const ctx = useContext(UpgradeModalContext);
  if (!ctx) {
    throw new Error(
      'useUpgradeModal must be used inside <UpgradeModalProvider>. ' +
      'Mount it once at the app shell (next to AdminShell).'
    );
  }
  return ctx;
}

/**
 * Read-only selector — returns just the open/close flag. Useful in
 * places that only care about visibility (e.g. disabling keyboard
 * shortcuts behind the modal).
 */
export function useUpgradeModalOpen(): boolean {
  return useUpgradeModal().isOpen;
}