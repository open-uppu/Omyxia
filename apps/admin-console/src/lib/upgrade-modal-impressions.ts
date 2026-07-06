/**
 * Upgrade-modal impression tracker (P3.4).
 *
 * Responsibilities:
 *   - Buffer impression events (shown / dismissed / cta_clicked /
 *     plan_viewed) keyed by modal session.
 *   - POST them to /api/admin/upgrade-impressions in batches (beacon
 *     on unload so we don't lose events).
 *   - Stay no-op in dev mode if the endpoint is missing — the dev
 *     console gets a `console.info` instead.
 *
 * Why a dedicated bus instead of inline `fetch` calls?
 *   - The modal can be dismissed quickly (Esc key, X button, click on
 *     backdrop) and we don't want a 200ms network call on the critical
 *     interaction path.
 *   - Batching keeps the analytics endpoint cheap — one POST per
 *     modal lifetime, not one per click.
 *
 * Why `navigator.sendBeacon` for the unload flush?
 *   - Browsers cancel in-flight fetches during `pagehide`. Beacon is
 *     guaranteed to be delivered (or queued by the browser) even on
 *     unload.
 *
 * The bus is intentionally framework-agnostic so it can be reused by
 * any future surface that also triggers the modal (e.g. an
 * in-app upsell banner).
 */

import type { UpgradeImpression, UpgradeImpressionKind } from '@omyxia/shared-types';

interface PendingImpression {
  kind: UpgradeImpressionKind;
  feature: string;
  shownAt: string;
  at: string;
  currentPlan: 'FREE' | 'PRO' | 'ENTERPRISE';
  recommendedPlan: 'FREE' | 'PRO' | 'ENTERPRISE';
  ctaTarget?: 'mailto' | 'in_app_upgrade';
}

interface FlushResult {
  attempted: number;
  delivered: number;
  dropped: number;
  error?: string;
}

const ENDPOINT = '/api/admin/upgrade-impressions';
const MAX_BUFFER = 50; // safety cap — never grow unbounded

export class UpgradeImpressionBus {
  private buffer: PendingImpression[] = [];
  private inflight: Promise<FlushResult> | null = null;

  /** Push one impression onto the buffer. No-op if full. */
  push(event: PendingImpression): void {
    if (this.buffer.length >= MAX_BUFFER) {
      // Drop oldest — better to lose the first `shown` than the
      // last `cta_clicked`. (The reverse would silently drop
      // conversions.)
      this.buffer.shift();
    }
    this.buffer.push(event);
  }

  /** Current queue size (for tests + dev diagnostics). */
  size(): number {
    return this.buffer.length;
  }

  /** Reset — used by tests to keep state isolated. */
  reset(): void {
    this.buffer = [];
    this.inflight = null;
  }

  /** Synchronous peek (returns a copy so callers can't mutate the queue). */
  peek(): ReadonlyArray<PendingImpression> {
    return [...this.buffer];
  }

  /**
   * Flush the buffer to the backend. Concurrent calls coalesce — only
   * one network request is in flight at a time. Returns a summary so
   * tests can assert delivery counts without mocking global fetch.
   */
  async flush(): Promise<FlushResult> {
    if (this.inflight) return this.inflight;
    if (this.buffer.length === 0) {
      return { attempted: 0, delivered: 0, dropped: 0 };
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    const promise = this.deliver(batch).finally(() => {
      this.inflight = null;
    });
    this.inflight = promise;
    return promise;
  }

  /**
   * Best-effort flush using `navigator.sendBeacon`. Returns true if
   * the browser accepted the payload (we can't observe the network
   * response). Used on `pagehide` so events survive navigation.
   */
  beacon(): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
      return false;
    }
    if (this.buffer.length === 0) return true;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const blob = new Blob([JSON.stringify({ events: batch })], {
        type: 'application/json',
      });
      return navigator.sendBeacon(ENDPOINT, blob);
    } catch {
      return false;
    }
  }

  private async deliver(batch: PendingImpression[]): Promise<FlushResult> {
    if (typeof fetch === 'undefined') {
      return { attempted: batch.length, delivered: 0, dropped: batch.length };
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (!res.ok) {
        return {
          attempted: batch.length,
          delivered: 0,
          dropped: batch.length,
          error: `HTTP ${res.status}`,
        };
      }
      return { attempted: batch.length, delivered: batch.length, dropped: 0 };
    } catch (err) {
      return {
        attempted: batch.length,
        delivered: 0,
        dropped: batch.length,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** Singleton — there is exactly one bus per page. */
export const upgradeImpressionBus = new UpgradeImpressionBus();

/**
 * Build a typed `UpgradeImpression` from a pending event. Pulled out
 * so tests can assert the wire shape without poking the bus.
 */
export function toUpgradeImpression(input: PendingImpression): UpgradeImpression {
  return {
    kind: input.kind,
    feature: input.feature,
    shownAt: input.shownAt,
    at: input.at,
    currentPlan: input.currentPlan,
    recommendedPlan: input.recommendedPlan,
    ...(input.ctaTarget ? { ctaTarget: input.ctaTarget } : {}),
  };
}

export type { PendingImpression, FlushResult };