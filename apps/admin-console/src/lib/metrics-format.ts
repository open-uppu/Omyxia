/**
 * Display formatters for DashboardMetrics values.
 *
 * Units:
 *   - Money values are received in **cents** (integer). We divide by 100
 *     and let `Intl.NumberFormat` add the currency glyph + grouping.
 *   - Storage values are received in **bytes**. We convert to the
 *     highest binary unit that keeps the value >= 1 (KiB → MiB → GiB → TiB).
 *   - Counts are integers; small ones thousand-grouped, big ones
 *     abbreviated (1.2k / 3.4M).
 *
 * All formatters are pure — no environment reads, no React. Safe to
 * call from server components and from the vitest suite.
 */

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const moneyPreciseFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFormatter = new Intl.NumberFormat('en-US');
const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const pctFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** Format cents → "$1,234" (whole dollars when >= $1). */
export function formatMoneyCents(cents: number, opts: { precise?: boolean } = {}): string {
  const dollars = cents / 100;
  if (!Number.isFinite(dollars)) return '—';
  if (opts.precise || (dollars !== 0 && Math.abs(dollars) < 1)) {
    return moneyPreciseFormatter.format(dollars);
  }
  return moneyFormatter.format(dollars);
}

/** Format bytes → human readable. E.g. 4_398_046_511_104 → "4.00 TiB". */
export function formatBytes(bytes: number, fractionDigits = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(fractionDigits)} ${units[i]}`;
}

/** Format integer counts. Big values get compact ("12.4k" / "3.4M"). */
export function formatCount(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '—';
  if (opts.compact) return compactFormatter.format(n);
  return intFormatter.format(Math.round(n));
}

/** Format a 0..1 share → "42.0%". */
export function formatShare(share: number): string {
  if (!Number.isFinite(share)) return '—';
  return pctFormatter.format(share);
}

/** Format an ISO date (YYYY-MM-DD) → "Jul 4". */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format an ISO timestamp → "14:00". */
export function formatHourLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Avoid relying on jsdom's incomplete `toLocaleTimeString` (which
  // silently strips minutes in some configurations). Extract directly
  // from the ISO string when the input looks well-formed.
  if (iso.length >= 16 && iso[10] === 'T' && iso[13] === ':') {
    return iso.slice(11, 16);
  }
  return d.toISOString().slice(11, 16);
}

/** Format a "X minutes ago" string from a past ISO timestamp. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const seconds = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Compute a +N / -N / "0" integer delta label. */
export function formatDelta(n: number): { label: string; tone: 'up' | 'down' | 'flat' } {
  if (!Number.isFinite(n) || n === 0) return { label: '0', tone: 'flat' };
  if (n > 0) return { label: `+${intFormatter.format(n)}`, tone: 'up' };
  return { label: intFormatter.format(n), tone: 'down' };
}
