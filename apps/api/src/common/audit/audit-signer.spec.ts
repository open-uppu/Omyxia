import { describe, expect, it } from 'vitest';
import {
  buildCanonicalMessage,
  signAuditRow,
  verifyAuditRow,
  InMemoryChainHeadCache,
} from './audit-signer';

const SECRET = 'a'.repeat(64); // 64 bytes — comfortably above the 32-byte floor

function row(partial: Partial<Parameters<typeof signAuditRow>[1]['row']> = {}) {
  return {
    id: 'audit-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    table: 'crm/leads',
    rowId: 'lead-1',
    action: 'CREATE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial,
  };
}

describe('AuditSigner', () => {
  describe('signAuditRow', () => {
    it('produces a 64-char hex digest', () => {
      const signed = signAuditRow(SECRET, { row: row(), previousSignature: null });
      expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws when AUDIT_HMAC_SECRET is missing', () => {
      expect(() => signAuditRow('', { row: row(), previousSignature: null })).toThrow(
        /AUDIT_HMAC_SECRET is not configured/,
      );
    });

    it('throws when AUDIT_HMAC_SECRET is < 32 bytes', () => {
      expect(() => signAuditRow('short', { row: row(), previousSignature: null })).toThrow(
        /at least 32 bytes/,
      );
    });

    it('returns the same signature when the row is identical', () => {
      const a = signAuditRow(SECRET, { row: row(), previousSignature: null });
      const b = signAuditRow(SECRET, { row: row(), previousSignature: null });
      expect(a.signature).toBe(b.signature);
    });

    it('changes the signature when any field changes', () => {
      const base = signAuditRow(SECRET, { row: row(), previousSignature: null });
      const t = signAuditRow(SECRET, { row: row({ tenantId: 'tenant-2' }), previousSignature: null });
      const u = signAuditRow(SECRET, { row: row({ userId: 'user-2' }), previousSignature: null });
      const a = signAuditRow(SECRET, { row: row({ action: 'UPDATE' }), previousSignature: null });
      const p = signAuditRow(SECRET, { row: row(), previousSignature: 'abc' });
      expect(t.signature).not.toBe(base.signature);
      expect(u.signature).not.toBe(base.signature);
      expect(a.signature).not.toBe(base.signature);
      expect(p.signature).not.toBe(base.signature);
    });

    it('is keyed by the previous signature (chain)', () => {
      const a = signAuditRow(SECRET, { row: row({ id: 'r1' }), previousSignature: null });
      const b = signAuditRow(SECRET, { row: row({ id: 'r2' }), previousSignature: a.signature });
      const c = signAuditRow(SECRET, { row: row({ id: 'r3' }), previousSignature: b.signature });
      expect(b.signature).not.toBe(a.signature);
      expect(c.signature).not.toBe(b.signature);

      // Re-signing r2 with a *different* previous must yield a different
      // signature — that's the chain-tamper detector.
      const bTampered = signAuditRow(SECRET, {
        row: row({ id: 'r2' }),
        previousSignature: 'fake-previous',
      });
      expect(bTampered.signature).not.toBe(b.signature);
    });
  });

  describe('buildCanonicalMessage', () => {
    it('is stable across runs for the same input', () => {
      const m1 = buildCanonicalMessage({ row: row(), previousSignature: 'aa' });
      const m2 = buildCanonicalMessage({ row: row(), previousSignature: 'aa' });
      expect(m1).toBe(m2);
    });

    it('embeds a v1: domain-separation prefix', () => {
      const m = buildCanonicalMessage({ row: row(), previousSignature: null });
      expect(m.startsWith('v1:')).toBe(true);
    });

    it('uses zero-bytes as the canonical "no previous" marker', () => {
      const m = buildCanonicalMessage({ row: row(), previousSignature: null });
      expect(m).toContain('\u0000'.repeat(64));
    });
  });

  describe('verifyAuditRow', () => {
    it('returns true for a row signed with the same secret', () => {
      const signed = signAuditRow(SECRET, { row: row(), previousSignature: null });
      const ok = verifyAuditRow(SECRET, { row: row(), previousSignature: null }, signed.signature);
      expect(ok).toBe(true);
    });

    it('returns false for a row modified after signing', () => {
      const signed = signAuditRow(SECRET, { row: row(), previousSignature: null });
      const ok = verifyAuditRow(
        SECRET,
        { row: row({ userId: 'attacker' }), previousSignature: null },
        signed.signature,
      );
      expect(ok).toBe(false);
    });

    it('returns false when the wrong secret is used', () => {
      const signed = signAuditRow(SECRET, { row: row(), previousSignature: null });
      const ok = verifyAuditRow('b'.repeat(64), { row: row(), previousSignature: null }, signed.signature);
      expect(ok).toBe(false);
    });

    it('returns false on a different-length signature', () => {
      const ok = verifyAuditRow(SECRET, { row: row(), previousSignature: null }, 'too-short');
      expect(ok).toBe(false);
    });
  });

  describe('InMemoryChainHeadCache', () => {
    it('returns null for unknown / null tenant ids', async () => {
      const cache = new InMemoryChainHeadCache();
      expect(await cache.get(null)).toBeNull();
      expect(await cache.get(undefined)).toBeNull();
      expect(await cache.get('unknown')).toBeNull();
    });

    it('round-trips a signature per tenant', async () => {
      const cache = new InMemoryChainHeadCache();
      cache.set('t-1', 'sig-1');
      cache.set('t-2', 'sig-2');
      expect(await cache.get('t-1')).toBe('sig-1');
      expect(await cache.get('t-2')).toBe('sig-2');
    });

    it('evicts the oldest tenant when the cache overflows', () => {
      const cache = new InMemoryChainHeadCache(2);
      cache.set('t-1', 's1');
      cache.set('t-2', 's2');
      cache.set('t-3', 's3'); // should evict t-1
      expect(cache['map'].has('t-1')).toBe(false); // implementation detail
      expect(cache['map'].has('t-2')).toBe(true);
      expect(cache['map'].has('t-3')).toBe(true);
    });
  });
});
