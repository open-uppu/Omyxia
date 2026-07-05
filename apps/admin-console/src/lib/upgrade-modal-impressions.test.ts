// @vitest-environment node
//
// Tests for the upgrade-modal impression bus. We exercise the
// singleton-free instance methods directly so the test doesn't
// pollute global fetch for other specs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  UpgradeImpressionBus,
  toUpgradeImpression,
  type PendingImpression,
} from './upgrade-modal-impressions';

function makeEvent(overrides: Partial<PendingImpression> = {}): PendingImpression {
  return {
    kind: 'shown',
    feature: 'module.crm',
    shownAt: '2026-07-04T12:00:00.000Z',
    at: '2026-07-04T12:00:01.000Z',
    currentPlan: 'FREE',
    recommendedPlan: 'PRO',
    ...overrides,
  };
}

describe('UpgradeImpressionBus', () => {
  let bus: UpgradeImpressionBus;

  beforeEach(() => {
    bus = new UpgradeImpressionBus();
  });

  it('starts empty', () => {
    expect(bus.size()).toBe(0);
    expect(bus.peek()).toEqual([]);
  });

  it('pushes events onto the buffer', () => {
    bus.push(makeEvent());
    bus.push(makeEvent({ kind: 'dismissed' }));
    expect(bus.size()).toBe(2);
    expect(bus.peek()[0]!.kind).toBe('shown');
    expect(bus.peek()[1]!.kind).toBe('dismissed');
  });

  it('caps the buffer at MAX_BUFFER (oldest dropped, not newest)', () => {
    // Force the cap by pushing > 50 events. The "shown" we push first
    // is the conversion baseline — we drop it (oldest) instead of the
    // newest CTA click, because losing conversions would skew metrics.
    for (let i = 0; i < 60; i++) {
      bus.push(makeEvent({ kind: i === 59 ? 'cta_clicked' : 'shown', at: `2026-07-04T12:00:${String(i).padStart(2, '0')}.000Z` }));
    }
    expect(bus.size()).toBe(50);
    const peeked = bus.peek();
    expect(peeked[peeked.length - 1]!.kind).toBe('cta_clicked');
    expect(peeked[0]!.at).not.toBe('2026-07-04T12:00:00.000Z');
  });

  describe('flush()', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      // Replace the module-level fetch reference. The bus captures
      // `fetch` lexically inside `deliver`, so we use vi.stubGlobal
      // to override `globalThis.fetch` (jsdom already provides fetch
      // in setup; the bus uses the same global lookup).
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not POST when the buffer is empty', async () => {
      const result = await bus.flush();
      expect(result.attempted).toBe(0);
      expect(result.delivered).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POSTs all queued events and reports success', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      bus.push(makeEvent());
      bus.push(makeEvent({ kind: 'dismissed' }));
      const result = await bus.flush();
      expect(result.attempted).toBe(2);
      expect(result.delivered).toBe(2);
      expect(result.dropped).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.events).toHaveLength(2);
      expect(body.events[0].kind).toBe('shown');
    });

    it('clears the buffer on success', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      bus.push(makeEvent());
      await bus.flush();
      expect(bus.size()).toBe(0);
    });

    it('requeues events when the backend returns non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      bus.push(makeEvent());
      const result = await bus.flush();
      expect(result.delivered).toBe(0);
      expect(result.dropped).toBe(1);
      expect(result.error).toBe('HTTP 500');
    });

    it('coalesces concurrent flushes', async () => {
      let resolveFetch: (r: Response) => void = () => {};
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((res) => { resolveFetch = res; })
      );
      bus.push(makeEvent());
      const a = bus.flush();
      const b = bus.flush();
      resolveFetch(new Response(null, { status: 200 }));
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra).toBe(rb);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports dropped + error when fetch throws', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'));
      bus.push(makeEvent());
      const result = await bus.flush();
      expect(result.delivered).toBe(0);
      expect(result.dropped).toBe(1);
      expect(result.error).toBe('network down');
    });
  });

  describe('beacon()', () => {
    it('returns false when sendBeacon is missing (jsdom)', () => {
      // jsdom doesn't implement sendBeacon — should bail silently.
      expect(bus.beacon()).toBe(false);
    });

    it('uses sendBeacon when available', () => {
      const sendBeacon = vi.fn().mockReturnValue(true);
      vi.stubGlobal('navigator', { sendBeacon });
      bus.push(makeEvent());
      const ok = bus.beacon();
      expect(ok).toBe(true);
      expect(sendBeacon).toHaveBeenCalledTimes(1);
      expect(bus.size()).toBe(0);
      vi.unstubAllGlobals();
    });

    it('returns true without calling sendBeacon when buffer is empty', () => {
      const sendBeacon = vi.fn();
      vi.stubGlobal('navigator', { sendBeacon });
      const ok = bus.beacon();
      expect(ok).toBe(true);
      expect(sendBeacon).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});

describe('toUpgradeImpression', () => {
  it('returns a wire-shape UpgradeImpression', () => {
    const wire = toUpgradeImpression(makeEvent({ kind: 'cta_clicked', ctaTarget: 'mailto' }));
    expect(wire).toMatchObject({
      kind: 'cta_clicked',
      feature: 'module.crm',
      ctaTarget: 'mailto',
    });
  });

  it('omits ctaTarget when undefined', () => {
    const wire = toUpgradeImpression(makeEvent({ kind: 'shown' }));
    expect('ctaTarget' in wire).toBe(false);
  });
});