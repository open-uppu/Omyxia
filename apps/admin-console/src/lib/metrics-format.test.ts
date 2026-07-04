import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCount,
  formatDelta,
  formatHourLabel,
  formatMoneyCents,
  formatRelativeTime,
  formatShare,
  formatShortDate,
} from './metrics-format';

describe('formatMoneyCents', () => {
  it('renders whole dollars without decimals', () => {
    expect(formatMoneyCents(123_456)).toBe('$1,235'); // rounded maxFrac=0
  });

  it('renders sub-dollar values with cents', () => {
    expect(formatMoneyCents(99)).toBe('$0.99');
  });

  it('handles zero', () => {
    expect(formatMoneyCents(0)).toBe('$0');
  });

  it('keeps precision for values < $1', () => {
    expect(formatMoneyCents(50)).toBe('$0.50');
  });

  it('returns an em-dash for non-finite input', () => {
    expect(formatMoneyCents(Number.NaN)).toBe('—');
    expect(formatMoneyCents(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('formats bytes under 1 KiB as raw bytes', () => {
    expect(formatBytes(0)).toBe('0.00 B');
    expect(formatBytes(1023)).toBe('1023.00 B');
  });

  it('picks the largest unit that keeps the value >= 1', () => {
    expect(formatBytes(1024, 0)).toBe('1 KiB');
    expect(formatBytes(1024 ** 2, 0)).toBe('1 MiB');
    expect(formatBytes(1024 ** 3, 0)).toBe('1 GiB');
    expect(formatBytes(1024 ** 4, 0)).toBe('1 TiB');
  });

  it('returns em-dash for negative or non-finite input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatCount', () => {
  it('uses thousand-grouping integers by default', () => {
    expect(formatCount(1234)).toBe('1,234');
  });

  it('uses compact notation when requested', () => {
    expect(formatCount(12_400, { compact: true })).toMatch(/12\.?4K?/i);
    expect(formatCount(2_500_000, { compact: true })).toMatch(/2\.5M/i);
  });
});

describe('formatShare', () => {
  it('renders 0..1 as percent', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.42)).toBe('42%');
    expect(formatShare(1)).toBe('100%');
  });
});

describe('formatShortDate', () => {
  it('renders YYYY-MM-DD as "Mon D"', () => {
    expect(formatShortDate('2026-07-04')).toBe('Jul 4');
  });

  it('returns the raw string for invalid input', () => {
    expect(formatShortDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatHourLabel', () => {
  it('renders ISO timestamps as HH:MM UTC (raw slice, locale-independent)', () => {
    expect(formatHourLabel('2026-07-04T09:00:00.000Z')).toBe('09:00');
    expect(formatHourLabel('2026-07-04T23:30:00.000Z')).toBe('23:30');
    expect(formatHourLabel('2026-07-04T00:00:00.000Z')).toBe('00:00');
  });

  it('falls back to ISO extraction for non-standard inputs', () => {
    expect(formatHourLabel('2026-07-04T01:23Z')).toBe('01:23');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-04T12:00:00.000Z');
  it('returns "Ns ago" / "Nm ago" / "Nh ago"', () => {
    expect(formatRelativeTime('2026-07-04T11:59:30.000Z', now)).toBe('30s ago');
    expect(formatRelativeTime('2026-07-04T11:55:00.000Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-07-04T10:00:00.000Z', now)).toBe('2h ago');
  });
});

describe('formatDelta', () => {
  it('signs positive deltas with "+"', () => {
    expect(formatDelta(7)).toEqual({ label: '+7', tone: 'up' });
  });

  it('keeps the minus sign on negative deltas', () => {
    expect(formatDelta(-3)).toEqual({ label: '-3', tone: 'down' });
  });

  it('returns tone="flat" for 0', () => {
    expect(formatDelta(0)).toEqual({ label: '0', tone: 'flat' });
  });
});
