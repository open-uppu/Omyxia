/**
 * omyxia v2.0.0 P4.1 — Stripe status mapping tests.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STRIPE_STATUSES,
  GRACE_STRIPE_STATUSES,
  TERMINAL_STRIPE_STATUSES,
  mapStripeStatus,
} from './stripe.types';

describe('mapStripeStatus', () => {
  it('maps common lowercase statuses to the enum', () => {
    expect(mapStripeStatus('active')).toBe('ACTIVE');
    expect(mapStripeStatus('trialing')).toBe('TRIALING');
    expect(mapStripeStatus('past_due')).toBe('PAST_DUE');
    expect(mapStripeStatus('canceled')).toBe('CANCELED');
    expect(mapStripeStatus('unpaid')).toBe('UNPAID');
    expect(mapStripeStatus('incomplete')).toBe('INCOMPLETE');
    expect(mapStripeStatus('incomplete_expired')).toBe('INCOMPLETE_EXPIRED');
    expect(mapStripeStatus('paused')).toBe('PAUSED');
  });

  it('returns INCOMPLETE (fail-closed) for unknown values', () => {
    expect(mapStripeStatus('definitely_unknown')).toBe('INCOMPLETE');
    expect(mapStripeStatus('')).toBe('INCOMPLETE');
    expect(mapStripeStatus('ARCHIVED')).toBe('INCOMPLETE');
  });

  it('exposes disjoint status buckets', () => {
    const overlap = (a: readonly string[], b: readonly string[]) =>
      a.filter((s) => b.includes(s));
    expect(overlap(ACTIVE_STRIPE_STATUSES, TERMINAL_STRIPE_STATUSES)).toEqual([]);
    expect(overlap(ACTIVE_STRIPE_STATUSES, GRACE_STRIPE_STATUSES)).toEqual([]);
    expect(overlap(GRACE_STRIPE_STATUSES, TERMINAL_STRIPE_STATUSES)).toEqual([]);
  });
});
