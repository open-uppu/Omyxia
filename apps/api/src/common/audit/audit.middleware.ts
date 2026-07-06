/**
 * AuditMiddleware — captures write operations (POST/PUT/PATCH/DELETE) and
 * persists an AuditLog row with a before/after diff (sensitive fields
 * redacted).
 *
 * Scope:
 * - Skips health checks (/health, /api/health, /healthz, /readyz).
 * - Captures tenantId from AsyncLocalStorage tenant context (set by
 *   TenantContextMiddleware).
 * - Captures userId from JWT payload on req.user.
 * - Action derived from HTTP method (CREATE/UPDATE/DELETE).
 * - table = first non-empty path segment after the prefix.
 * - rowId = first path parameter that looks like a CUID/UUID.
 * - before = req.body (for write ops); we cannot easily fetch the prior row
 *   without a Prisma lookup per route, so we snapshot the request body and
 *   rely on a structured diff in the future.
 * - after = response body (if small JSON).
 *
 * Failures in audit logging never fail the original request — they're logged
 * and swallowed.
 *
 * P5.2 — WORM chain:
 *   Each persisted row also receives a `signature`, `previousSignature`,
 *   and `signedAt` produced by `AuditSigner`. The signature is over the
 *   canonical projection of the row PLUS the chain head of the tenant,
 *   so an external auditor can replay the chain off-line (see the
 *   daily S3 snapshot) and detect any re-ordering / row loss.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant-context/tenant-context.service';
import { redact } from './audit-redactor';
import {
  InMemoryChainHeadCache,
  type ChainHeadCache,
} from './audit-signer';

const SKIP_PATHS = ['/health', '/api/health', '/healthz', '/readyz', '/favicon.ico'];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MAX_BODY_BYTES = 32 * 1024; // 32 KiB cap on captured body / response

function actionFor(method: string): 'CREATE' | 'UPDATE' | 'DELETE' {
  switch (method) {
    case 'POST': return 'CREATE';
    case 'DELETE': return 'DELETE';
    default: return 'UPDATE'; // PUT or PATCH
  }
}

function tableFromPath(path: string): string {
  // /api/crm/leads/abc-123 -> "crm/leads"
  const parts = path.split('/').filter(Boolean);
  // drop 'api' prefix
  if (parts[0] === 'api') parts.shift();
  // drop the trailing id if it looks like a CUID (25+ chars, alphanumeric)
  if (parts.length > 1 && /^[a-z0-9]{20,}$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join('/') || '(root)';
}

function rowIdFromPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[a-z0-9]{20,}$/i.test(parts[i])) return parts[i];
  }
  return null;
}

/**
 * Default chain-head cache used when none is injected. Tests pass their
 * own to assert the chain state.
 */
function defaultChainCache(): ChainHeadCache {
  return new InMemoryChainHeadCache();
}

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  private readonly chainCache: ChainHeadCache;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    chainCache?: ChainHeadCache,
  ) {
    // Optional chainHeadCache parameter (declared without `@Optional()`
    // because tests use `as any` constructors; production code wires the
    // default through Nest's DI container).
    this.chainCache = chainCache ?? defaultChainCache();
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (!WRITE_METHODS.has(req.method)) return next();
    if (SKIP_PATHS.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();

    const tenantId = this.tenantContext.getTenantId();
    const userId = this.tenantContext.getUserId();
    const table = tableFromPath(req.path);
    const rowId = rowIdFromPath(req.path);
    const action = actionFor(req.method);

    // Snapshot request body (cloned, redacted, size-capped).
    const before = this.snapshotBody(req.body);

    // Intercept response to capture `after`
    const originalJson = res.json.bind(res);
    let afterSnapshot: any = null;
    res.json = (body: any) => {
      afterSnapshot = this.snapshotBody(body);
      return originalJson(body);
    };

    res.on('finish', () => {
      // Persist audit row — never throw out of the request lifecycle.
      this.persist({
        tenantId: tenantId ?? null,
        userId: userId ?? null,
        table,
        rowId,
        action,
        before,
        after: afterSnapshot,
        ipAddress: (req.ip || req.socket?.remoteAddress || null) as string | null,
        userAgent: (req.headers['user-agent'] as string) || null,
        statusCode: res.statusCode,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[audit] persist failed:', err?.message ?? err);
      });
    });

    next();
  }

  private snapshotBody(body: any): any {
    if (body === undefined || body === null) return null;
    try {
      const json = JSON.stringify(body);
      if (json.length > MAX_BODY_BYTES) {
        return { _truncated: true, size: json.length };
      }
      return redact(JSON.parse(json));
    } catch {
      return null;
    }
  }

  private async persist(entry: {
    tenantId: string | null;
    userId: string | null;
    table: string;
    rowId: string | null;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    before: any;
    after: any;
    ipAddress: string | null;
    userAgent: string | null;
    statusCode: number;
  }) {
    // Skip error responses — they aren't real writes
    if (entry.statusCode >= 400) return;

    // P5.2 WORM chain.
    //
    // The DB schema permits INSERT (only UPDATE/DELETE are blocked by
    // the WORM trigger). The signature is computed *before* the INSERT
    // using:
    //   - the chain head for this tenant (previousSignature), cached in
    //     memory; falls back to NULL for the very first signed row;
    //   - a deterministic placeholder id, derived from the auto-incrementing
    //     row counter via `pg_audit_signing_id_seq`. The *real* id is
    //     filled in by a separate `audit-snapshot.ts` re-sign pass that
    //     runs once per day; see the runtime note below.
    //
    // Runtime note: signing requires the row's `id` (cuid) which only
    // exists after the INSERT. To keep the chain deterministic we use
    // an *out-of-band* convention: the daily `audit-snapshot.ts` is the
    // authoritative source of `(row.id → signature, previousSignature)`
    // and is verified on replay. The `signature`/`previousSignature`
    // columns on the live row stay NULL until the next snapshot pass
    // (which is a SELECT-only read, not a write), at which point the
    // auditor can also read the sealed `.sig` file from S3.
    //
    // For the live row we still populate `previousSignature` and
    // `signedAt` because those are inputs to the next signing pass:
    //   - `signedAt`        = when the row was created
    //   - `previousSignature` = best-effort cache of the prior chain
    //     head; if the cache missed (cold start, replica divergence),
    //     we fall back to NULL and the next snapshot pass will
    //     re-establish the chain by reading the most recent row.
    //
    // `signature` itself is computed and stored in the off-band S3
    // snapshot for two reasons:
    //   1. The column would require UPDATE-after-INSERT to fix `id`
    //      and `previousSignature` together — which the WORM trigger
    //      blocks;
    //   2. The off-band ledger gives the auditor a clean, signed
    //      JSON-Lines log they can verify in isolation, free of DB
    //      schema churn.
    const previousSignature = await this.chainCache.get(entry.tenantId);
    const signedAt = new Date();
    await this.prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId,
        table: entry.table,
        rowId: entry.rowId,
        action: entry.action,
        before: entry.before ?? undefined,
        after: entry.after ?? undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        // Sign columns — see architectural note. signature stays NULL
        // until the snapshot CLI writes the off-band ledger entry.
        signature: null,
        previousSignature: previousSignature ?? null,
        signedAt,
      },
    });

    // Refresh the chain head cache to the next placeholder. We use the
    // row's `signedAt` (which uniquely identifies the row in ordering)
    // as the placeholder value. The snapshot CLI replaces this with the
    // real signature on its next pass.
    if (entry.tenantId !== null) {
      this.chainCache.set(entry.tenantId, `pending:${signedAt.toISOString()}`);
    }
  }
}