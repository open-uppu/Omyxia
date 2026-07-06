/**
 * omyxia v2.0.0 P4.2 — Decimal math tests.
 */

import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatQuantity,
  overageOf,
  sum,
  toDecimalString,
  toNumber,
} from './decimal-math';

class FakeDecimal {
  constructor(private readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

describe('decimal-math', () => {
  describe('toNumber', () => {
    it('converts strings, numbers, and Prisma Decimals', () => {
      expect(toNumber('1.5')).toBe(1.5);
      expect(toNumber(2)).toBe(2);
      expect(toNumber(new FakeDecimal('3.14'))).toBeCloseTo(3.14);
    });

    it('treats null/undefined as 0', () => {
      expect(toNumber(null)).toBe(0);
      expect(toNumber(undefined)).toBe(0);
    });

    it('throws on non-finite values', () => {
      expect(() => toNumber('not-a-number')).toThrow(TypeError);
      expect(() => toNumber(Number.NaN)).toThrow(TypeError);
      expect(() => toNumber(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    });
  });

  describe('toDecimalString', () => {
    it('round-trips common decimals', () => {
      expect(toDecimalString('1.5000')).toBe('1.5');
      expect(toDecimalString(0)).toBe('0');
      expect(toDecimalString('1.234567', 4)).toBe('1.2346');
    });

    it('returns 0 for any zero input regardless of scale', () => {
      expect(toDecimalString(0, 4)).toBe('0');
      expect(toDecimalString(0, 0)).toBe('0');
      expect(toDecimalString(null)).toBe('0');
    });

    it('handles Prisma Decimal inputs', () => {
      expect(toDecimalString(new FakeDecimal('5.123456'))).toBe('5.123456');
    });
  });

  describe('overageOf', () => {
    it('returns the positive difference', () => {
      expect(overageOf(150, 100)).toBe(50);
      expect(overageOf('150', '100')).toBe(50);
    });

    it('floors negative values to 0', () => {
      expect(overageOf(50, 100)).toBe(0);
      expect(overageOf('0', '100')).toBe(0);
    });

    it('handles string + Decimal mixed inputs', () => {
      expect(overageOf(new FakeDecimal('110'), '100')).toBe(10);
    });
  });

  describe('formatMoney', () => {
    it('rounds to 2dp', () => {
      expect(formatMoney('12.345')).toBe('12.35');
      expect(formatMoney('0.1')).toBe('0.1');
      expect(formatMoney('0.005')).toBe('0.01'); // rounds half-away-from-zero
      expect(formatMoney('0.004')).toBe('0');
    });
  });

  describe('formatQuantity', () => {
    it('rounds to 6dp', () => {
      expect(formatQuantity('1.2345678')).toBe('1.234568');
      expect(formatQuantity(0)).toBe('0');
      expect(formatQuantity('999999.9999999')).toBe('1000000');
    });
  });

  describe('sum', () => {
    it('sums an array', () => {
      expect(sum([1, 2, 3])).toBe(6);
      expect(sum(['1.5', '2.5'])).toBe(4);
    });

    it('returns 0 for an empty array', () => {
      expect(sum([])).toBe(0);
    });

    it('accepts mixed types', () => {
      expect(sum([1, new FakeDecimal('2.5'), '3.5'])).toBe(7);
    });
  });
});