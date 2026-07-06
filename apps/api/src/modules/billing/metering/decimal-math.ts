/**
 * omyxia v2.0.0 P4.2 — Decimal math utilities.
 *
 * The metering module does arithmetic on `Decimal` columns using JS's
 * native `number` type, but we accept/reject string decimals at the
 * boundary to avoid the well-known float-precision foot-guns.
 *
 * We intentionally do NOT pull in a Decimal library (e.g. decimal.js,
 * big.js) — the operations we do here are simple (add, subtract, max,
 * floor to zero, scale to N decimal places) and they all fit in
 * `Number.MAX_SAFE_INTEGER` for our use cases (storage < 1M GB, API
 * calls < 1B/mo, users < 100k). The cost/benefit of adding a 100KB
 * library is not worth it; instead we round with explicit precision at
 * the wire boundary.
 *
 * If the math ever grows beyond `Number.MAX_SAFE_INTEGER` (10^15), the
 * affected code path will be the `OverageInvoiceItem.amount` field —
 * $1B in API-call overage would push us close. When that happens,
 * swap this module for `decimal.js` and keep the call sites unchanged.
 */

/** Anything that has a `toString()` (Prisma Decimal satisfies this). */
interface ToStringable {
  toString(): string;
}

/** All accepted decimal-like types. */
export type DecimalLike = string | number | null | undefined | ToStringable;

/**
 * Convert a Decimal-ish value to a JS `number`. Accepts Prisma
 * `Decimal` (anything with a `toString()` method), strings, numbers, or
 * null/undefined. Returns `0` for null/undefined and throws on non-finite.
 */
export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  let n: number;
  if (typeof value === 'string') {
    n = Number(value);
  } else if (typeof value === 'number') {
    n = value;
  } else {
    // Prisma Decimal — `toString()` is lossless up to its declared
    // precision (DECIMAL(20,6) for our quantity columns).
    n = Number(value.toString());
  }
  if (!Number.isFinite(n)) {
    throw new TypeError(`toNumber: not a finite number: ${String(value)}`);
  }
  return n;
}

/**
 * Convert any Decimal-ish value to a canonical string with at most
 * `scale` decimal places, no trailing zeros, no scientific notation.
 *
 * Examples:
 *   toDecimalString('1.5000')                  → '1.5'
 *   toDecimalString('1.5000', 4)               → '1.5000'
 *   toDecimalString(0, 2)                      → '0'
 *   toDecimalString('0.00000001', 6)           → '0.000001' (rounded)
 */
export function toDecimalString(value: DecimalLike, scale = 6): string {
  const n = toNumber(value);
  if (n === 0) return '0';
  // toFixed rounds half-away-from-zero, which matches Stripe's expected
  // rounding for invoice line items.
  const fixed = n.toFixed(scale);
  // Strip trailing zeros after the decimal point but keep the dot if any.
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
}

/**
 * `max(a - b, 0)` — used to compute overage. Floors negative values to
 * zero so a tenant below quota is never charged an "overage" of -1 GB.
 */
export function overageOf(actual: DecimalLike, included: DecimalLike): number {
  return Math.max(toNumber(actual) - toNumber(included), 0);
}

/**
 * Round an amount to 2 decimal places (cents) and return a string.
 * Stripe rejects amounts with more than 2dp on USD invoices.
 */
export function formatMoney(amount: DecimalLike): string {
  return toDecimalString(amount, 2);
}

/**
 * Round a quantity to 6 decimal places — used when we project Prisma
 * Decimal fields back to a wire string. We pick 6 because the migration
 * declares `quantity` as `DECIMAL(20,6)` and we never want to silently
 * truncate at the boundary.
 */
export function formatQuantity(amount: DecimalLike): string {
  return toDecimalString(amount, 6);
}

/**
 * Sum an array of decimal strings/numbers. Returns `0` for an empty
 * array. Used by the aggregation layer.
 */
export function sum(values: ReadonlyArray<DecimalLike>): number {
  let total = 0;
  for (const v of values) total += toNumber(v);
  return total;
}