/**
 * Admin Console — Super-admin impersonation wire format (P1.7).
 *
 * Lives in `@omyxia/shared-types` so:
 *   - The admin-console frontend (P2.4 — tenant detail / "Impersonate"
 *     button) can validate the response shape and POST the same
 *     request body the API accepts.
 *   - The tenant-UI frontend (P2.4 — banner that says "You are
 *     impersonating …") can poll `GET /api/auth/impersonate/me` and
 *     parse the same session shape on every page load.
 *   - The NestJS API issues a JWT that includes the `originalAdminId`,
 *     `targetTenantId`, and `impersonation` claims; the
 *     `IMPERSONATION_TTL_SECONDS` constant is the single source of
 *     truth for the 1-hour TTL.
 *
 * Conventions:
 *   - All enum values are SCREAMING_SNAKE_CASE strings.
 *   - All timestamps are ISO 8601 strings (zod `.datetime()` accepts
 *     the same shape the API emits).
 *   - Reasons are short free-text — they go into AuditLog.after on
 *     `START`, `STOP`, and `EXPIRE` events and into the WebSocket
 *     broadcast payload so other super_admins see "admin X is
 *     impersonating tenant Y — reason: …".
 *
 * This module is intentionally pure-data — no React, no hooks, no
 * environment reads — so it can be imported from the React tree, the
 * NestJS API, and the standalone shared-types test suite.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * Hard TTL for an impersonation session.
 *
 * Set to 1 hour because every audit-trail entry during the session
 * must show "original_admin_id = …" + "impersonation_session_id = …"
 * (P5.2 escalates the AuditLog storage to WORM, so historical rows
 * are immutable). If you change this value, all in-flight sessions
 * minted before the change keep their original `exp` — they simply
 * expire sooner than new ones.
 */
export const IMPERSONATION_TTL_SECONDS = 60 * 60;

/** Millisecond-form of {@link IMPERSONATION_TTL_SECONDS}. */
export const IMPERSONATION_TTL_MS = IMPERSONATION_TTL_SECONDS * 1000;

// ============================================================================
// Reason taxonomy
// ============================================================================

/**
 * Canonical reason codes for why a super_admin is impersonating a
 * tenant. The enum gives us a tractable audit-reporting dimension
 * (count of "SUPPORT" vs "MIGRATION" impersonations) while still
 * letting the admin append a short free-text `notes` value for the
 * ticket / case id at the call site.
 *
 * `OTHER` is intentionally the last option — every real ticket
 * should land on a specific bucket so the support ops dashboard
 * stays useful.
 */
export const ImpersonationReasonSchema = z.enum([
  'SUPPORT',
  'AUDIT',
  'DEBUG',
  'MIGRATION',
  'OTHER',
]);
export type ImpersonationReason = z.infer<typeof ImpersonationReasonSchema>;

// ============================================================================
// Request body — POST /api/admin/impersonate/:tenantId
// ============================================================================

/**
 * Body the admin-console FE POSTs to start an impersonation session.
 *
 * The tenant id comes from the URL path (`:tenantId`); the body
 * carries the *why*. We don't put the reason in the path so it can
 * contain slashes / spaces without URL-encoding headaches.
 *
 * Notes:
 *   - `reason` is required and bounded to 500 chars — long enough
 *     for "SUP-1234 customer reports duplicated invoice", short
 *     enough to fit a single AuditLog row.
 *   - `reasonCode` is the structured taxonomy ({@link
 *     ImpersonationReasonSchema}); `reason` is the free-text
 *     explanation. At least one of them is required so the audit
 *     log is never empty.
 */
export const ImpersonationStartRequestSchema = z
  .object({
    reasonCode: ImpersonationReasonSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type ImpersonationStartRequest = z.infer<
  typeof ImpersonationStartRequestSchema
>;

// ============================================================================
// Wire shapes — ImpersonationSession, response, "who am I"
// ============================================================================

/**
 * One impersonation session row, mapped to the wire format.
 *
 * Carries the bare minimum the FE needs:
 *   - `sessionId`            — what to POST to DELETE /api/admin/impersonate/:sessionId
 *   - `superAdminId/Email/Name` — who is impersonating (for the banner)
 *   - `tenantId/Name/Slug`   — who is being impersonated (for the banner)
 *   - `reason/reasonCode`    — why (for the banner AND for the WebSocket broadcast payload)
 *   - `startedAt/expiresAt`  — TTL countdown shown on the banner
 *   - `ttlSeconds`           — convenience: the FE doesn't have to
 *                              compute `expiresAt - startedAt` itself
 *
 * The raw DB row stores `auditLogId` (the AuditLog row written when
 * the session started) too — that's server-side only and is NOT
 * exposed in this DTO.
 */
export const ImpersonationSessionSchema = z.object({
  sessionId: z.string(),
  superAdminId: z.string(),
  superAdminEmail: z.string().email(),
  superAdminName: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  reasonCode: ImpersonationReasonSchema,
  reason: z.string(),
  startedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  ttlSeconds: z.number().int().positive(),
});
export type ImpersonationSession = z.infer<typeof ImpersonationSessionSchema>;

/**
 * Response body for POST /api/admin/impersonate/:tenantId.
 *
 * Returns:
 *   - `session`       — the new {@link ImpersonationSession}
 *   - `accessToken`   — the impersonation-scoped JWT (the FE
 *                       replaces its admin JWT with this one for the
 *                       duration of the session). The token is
 *                       signed with HS256 against the same
 *                       `JWT_SECRET` the rest of the API uses;
 *                       see {@link ImpersonationJwtClaims}.
 *   - `ttlSeconds`    — duplicated here so the FE's expiry timer
 *                       doesn't need to start a clock before it
 *                       has parsed the body.
 *   - `expiresAt`     — ISO 8601, mirrored from `session.expiresAt`.
 */
export const ImpersonationTokenResponseSchema = z.object({
  session: ImpersonationSessionSchema,
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  ttlSeconds: z.number().int().positive(),
});
export type ImpersonationTokenResponse = z.infer<
  typeof ImpersonationTokenResponseSchema
>;

/**
 * Response body for GET /api/auth/impersonate/me.
 *
 * The endpoint is tenant-UI-facing (the banner calls it on every
 * load). It returns `{ session: null }` when the current JWT is NOT
 * an impersonation token (i.e. the regular super_admin session, or
 * no token at all), so the FE can `if (session) showBanner()`.
 *
 * 204 No-Content is intentionally NOT used: keeping a JSON envelope
 * makes the FE a single `await res.json()` with no extra branch.
 */
export const ImpersonationMeResponseSchema = z.object({
  session: ImpersonationSessionSchema.nullable(),
});
export type ImpersonationMeResponse = z.infer<
  typeof ImpersonationMeResponseSchema
>;

// ============================================================================
// JWT shape — what every issuer / verifier MUST agree on
// ============================================================================

/**
 * Custom JWT claims carried by an impersonation-scoped token.
 *
 * The base JWT payload (standard `@nestjs/jwt` HS256) is:
 *   - sub              — super_admin user id (so AuditLog.userId
 *                        attributes the action to the admin)
 *   - iat / exp        — standard timestamps
 *
 * The additions for impersonation are:
 *   - activeTenantId   — same as the URL :tenantId (so the existing
 *                        TenantContextMiddleware keeps working
 *                        without modification)
 *   - targetTenantId   — explicit claim, redundant with
 *                        `activeTenantId` but easier to grep for in
 *                        the audit log
 *   - role             — `'OWNER'` synthesised for the duration of
 *                        the impersonation (the admin acts as the
 *                        tenant owner so they can do anything during
 *                        support windows)
 *   - originalAdminId  — same as `sub`; explicit claim so SOC2
 *                        auditors can find every impersonation-driven
 *                        audit row with `WHERE jwt_payload ? 'originalAdminId'`
 *   - impersonation    — always `true` on these tokens; the FE banner
 *                        uses this as a sanity flag
 *   - impersonationSessionId — cuid; every AuditLog row carries
 *                        `metadata.impersonationSessionId` so the
 *                        post-merge "show me everything admin X did
 *                        while impersonating tenant Y" query is a
 *                        single indexed lookup
 *   - impersonationReasonCode — see {@link ImpersonationReasonSchema}
 *   - impersonationReason     — free-text
 */
export const ImpersonationJwtClaimsSchema = z.object({
  sub: z.string(),
  activeTenantId: z.string(),
  targetTenantId: z.string(),
  role: z.literal('OWNER'),
  originalAdminId: z.string(),
  impersonation: z.literal(true),
  impersonationSessionId: z.string(),
  impersonationReasonCode: ImpersonationReasonSchema,
  impersonationReason: z.string().min(3).max(500),
  iat: z.number().int().nonnegative().optional(),
  exp: z.number().int().nonnegative().optional(),
});
export type ImpersonationJwtClaims = z.infer<
  typeof ImpersonationJwtClaimsSchema
>;

// ============================================================================
// Server-event payload — admin:impersonate:started
// ============================================================================

/**
 * Payload of the `admin:impersonate:started` WebSocket event.
 *
 * Sent to every OTHER super_admin's `user:<id>` room so they see
 * the system-wide impersonation banner ("admin X is impersonating
 * tenant Y, reason: …") in real time. The admin who started the
 * session does NOT receive the event on their own user room — they
 * already know they did it (the HTTP response tells them).
 */
export const AdminImpersonateStartedPayloadSchema = z.object({
  sessionId: z.string(),
  superAdminId: z.string(),
  superAdminEmail: z.string().email(),
  superAdminName: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  reasonCode: ImpersonationReasonSchema,
  reason: z.string(),
  startedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});
export type AdminImpersonateStartedPayload = z.infer<
  typeof AdminImpersonateStartedPayloadSchema
>;

/**
 * Payload of the `admin:impersonate:ended` WebSocket event.
 *
 * Emitted when an impersonation session ends early (DELETE …/:id)
 * or expires by `exp`. Pairs with {@link AdminImpersonateStartedPayload}
 * so the admin-console live indicator clears.
 */
export const AdminImpersonateEndedPayloadSchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(),
  endedAt: z.string().datetime({ offset: true }),
  endedReason: z.enum(['STOPPED', 'EXPIRED', 'SUPERSEDED']),
});
export type AdminImpersonateEndedPayload = z.infer<
  typeof AdminImpersonateEndedPayloadSchema
>;
