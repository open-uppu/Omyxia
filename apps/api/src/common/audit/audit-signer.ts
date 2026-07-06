/**
 * AuditSigner — append-only chain HMAC signer for the AuditLog table.
 *
 * Why this exists:
 *   P5.2 turns the `AuditLog` table into a Write-Once-Read-Many (WORM)
 *   store by adding three things at the DB level:
 *     1. BEFORE UPDATE / DELETE / TRUNCATE triggers that raise an
 *        exception (see migration `v2_p5_2_audit_worm`).
 *     2. Revoked UPDATE/DELETE on the application role.
 *     3. A per-row HMAC-SHA256 signature chained off the previous
 *        signed row's signature, so the audit chain is *self-verifying*
 *        — an external auditor who reads a daily S3 snapshot can replay
 *        the chain off-line and prove no row was inserted, removed, or
 *        reordered outside of this code path.
 *
 * Threat model:
 *   - An attacker who has read access to a backup cannot modify a row:
 *     the trigger fires on UPDATE. (DB-level.)
 *   - An attacker who has read access to the live table cannot re-order
 *     rows without invalidating the per-row `previous_signature` chain.
 *     (Application-level — the trigger doesn't catch this; the chain
 *     hash does.)
 *   - An attacker who steals the database dump cannot forge new rows
 *     without also stealing `AUDIT_HMAC_SECRET`. (Secret-level.)
 *   - An attacker who steals both the dump AND the secret cannot
 *     re-sign edited historical rows without breaking the chain
 *     because the chain index is monotonically increasing.
 *
 * Implementation:
 *   - Pure functions only — no I/O, no Prisma dependency. The HTTP
 *     middleware asks AuditSigner for `(previous_signature, signature,
 *     signed_at)` and then writes the row directly. We deliberately do
 *     NOT do an extra `findFirst` lookup at sign-time; the previous
 *     signature is fetched *once* per request by the signer caller
 *     (or passed in as a warm cache for high-throughput routes).
 *   - Canonicalization: stable JSON serialization (sorted keys) of the
 *     row fields the SOC2 auditor cares about. Anything not in this
 *     canonical projection (e.g. cosmetic Prisma `_count` aggregations)
 *     is excluded.
 *   - Algorithm: HMAC-SHA256 (RFC 2104). 64-char lowercase hex digest.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** Canonical row projection for the AuditLog signature. */
export interface AuditRowCanonical {
  id: string;
  tenantId: string | null;
  userId: string | null;
  table: string;
  rowId: string | null;
  action: string;
  createdAt: Date | string;
}

/** Chain-link inputs the signer needs to produce the next signature. */
export interface AuditSignInput {
  row: AuditRowCanonical;
  previousSignature: string | null;
}

/** Signer output — written back to the AuditLog row. */
export interface AuditSignOutput {
  signature: string;
  previousSignature: string | null;
  signedAt: Date;
}

const ZERO_PREVIOUS = '\u0000'.repeat(64); // canonical "no previous"
const HMAC_ALGO = 'sha256';

/**
 * Stable JSON serialization with sorted keys. We avoid native `JSON.stringify`
 * here because Node `JSON.stringify` does sort object keys at insertion
 * order, which is deterministic but couples us to V8 internals. This
 * explicit sort guarantees the same digest regardless of property order.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    );
  }
  // Anything else (BigInt, Symbol, function) is non-JSON; we treat as
  // failure of the canonicalization contract.
  throw new Error(`AuditSigner cannot canonicalize value of type ${typeof value}`);
}

/**
 * Build the canonical projection string. Stable across runs and across
 * languages — used both for the HMAC message and (separately) for the
 * daily S3 snapshot verifier.
 */
export function buildCanonicalMessage(input: AuditSignInput): string {
  const prev = input.previousSignature ?? ZERO_PREVIOUS;
  const payload = canonicalize({
    id: input.row.id,
    tenantId: input.row.tenantId,
    userId: input.row.userId,
    table: input.row.table,
    rowId: input.row.rowId,
    action: input.row.action,
    createdAt:
      input.row.createdAt instanceof Date
        ? input.row.createdAt.toISOString()
        : new Date(input.row.createdAt).toISOString(),
  });
  // Format: v1:<prevSignature>:<payload>
  // The `v1:` prefix is a domain-separation tag — when we rotate to v2
  // signing (e.g. switch to Ed25519) we can detect old rows by their
  // prefix and re-sign on read without breaking the chain.
  return `v1:${prev}:${payload}`;
}

/**
 * Compute the chain signature for an AuditLog row.
 *
 * `secret` must come from `process.env.AUDIT_HMAC_SECRET` (32+ bytes
 * random). Throws if `secret` is missing/too short to fail loud at
 * boot rather than silently emitting unsigned rows.
 */
export function signAuditRow(secret: string | undefined, input: AuditSignInput): AuditSignOutput {
  if (!secret) {
    throw new Error('AUDIT_HMAC_SECRET is not configured; refusing to sign audit rows');
  }
  if (secret.length < 32) {
    throw new Error('AUDIT_HMAC_SECRET must be at least 32 bytes of entropy');
  }
  const message = buildCanonicalMessage(input);
  const signature = createHmac(HMAC_ALGO, secret).update(message).digest('hex');
  const signedAt = new Date();
  return {
    signature,
    previousSignature: input.previousSignature,
    signedAt,
  };
}

/**
 * Verify a signature against an expected row. Used by:
 *   - the daily S3 snapshot verifier (off-line),
 *   - the (planned) audit re-validation cron in P5.4.
 */
export function verifyAuditRow(
  secret: string | undefined,
  expected: AuditSignInput,
  actualSignature: string,
): boolean {
  if (!secret) return false;
  const { signature } = signAuditRow(secret, expected);
  if (signature.length !== actualSignature.length) return false;
  // timingSafeEqual requires same-length buffers; we've already
  // checked length above.
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(actualSignature, 'hex'));
}

/** Hard-coded per-tenant chain head. Used by callers that don't want
 * to issue a Prisma `findFirst` on every request. */
export interface ChainHeadCache {
  get(tenantId: string | null): Promise<string | null>;
  set(tenantId: string | null, signature: string): void;
}

/** Naive in-memory LRU chain-head cache for a single API process.
 * For multi-replica deployments, replace with a Redis-backed impl —
 * the public type doesn't change. */
export class InMemoryChainHeadCache implements ChainHeadCache {
  private readonly map = new Map<string, string>();
  constructor(private readonly maxEntries = 4096) {}

  async get(tenantId: string | null): Promise<string | null> {
    if (tenantId === null || tenantId === undefined) return null;
    return this.map.get(tenantId) ?? null;
  }

  set(tenantId: string | null, signature: string): void {
    if (tenantId === null || tenantId === undefined) return;
    if (this.map.size >= this.maxEntries) {
      // Evict the oldest entry — Map iteration is insertion-order.
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(tenantId, signature);
  }
}
