# Attack Surface (v2.0.0)

> **SOC2 scope:** This document covers the v2.0.0 Omyxia deployment,
> including the admin console, the workspace API, the Stripe billing
> module, and the new P5.2 WORM audit log. It maps every public surface
> against the five SOC2 Common Criteria (CC6.x access control,
> CC7.x system operations) and lists the corresponding implementation
> control with code references.
>
> **How to use this doc.** "Endpoint" sections enumerate the route +
> auth method; "Surface" sections enumerate non-HTTP attack surfaces
> (storage buckets, scheduled jobs, secrets); "Hardening checklist" at
> the bottom is the single source of truth for "is this prod-ready?".
>
> **What changed in v2.0.0 vs v1.0.0:**
>   - New admin console at `admin.omyxia.app` (P1.x), gated by
>     `@Roles('SUPER_ADMIN')` + a per-request WORM audit row.
>   - New feature-gating layer (`@RequiresFeature`) wired into 14
>     controllers (P3.1). Surfaces that used to be "always allowed"
>     are now 403-FEATURE_NOT_INCLUDED for tenants below the plan's
>     feature matrix.
>   - New Stripe billing API (P4.1). `/api/billing/stripe/webhook`
>     is the only public unauthenticated POST in v2.0.0 besides
>     `/api/auth/login`; the webhook verifies a Stripe-Signature HMAC.
>   - New P5.2 audit-log WORM chain + daily S3 Object-Lock snapshot.
>     Auditors get a tamper-evident, off-band chain hash.
>   - New admin endpoints `POST /admin/audit/snapshot/run` and
>     `GET  /admin/audit/integrity` (super-admin only).

## Endpoints exposed

### Public (unauthenticated)

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login`                | none | bcrypt 12 rounds; rate-limited at the ingress |
| `POST /api/auth/signup`               | none | tenant creation is single-row transactional |
| `POST /api/auth/onboarding/complete`  | none | onboarding wizard completion |
| `GET  /api/auth/mfa/challenge`        | none | short-lived token challenge |
| `POST /api/billing/stripe/webhook`    | HMAC | Stripe-Signature against `STRIPE_WEBHOOK_SECRET` |
| `GET  /health`, `/api/health`, `/healthz`, `/readyz` | none | liveness/readiness for K8s probes |
| `GET  /favicon.ico`                   | none | static |

All other routes require a valid `Authorization: Bearer <jwt>` header.

### Role-gated (RBAC)

The full endpoint × role matrix lives in [RBAC_MATRIX.md](./RBAC_MATRIX.md).
This section only summarizes the trust model.

- **`SUPER_ADMIN`** — cross-tenant break-glass. Every action logged to
  the WORM audit log via `AuditMiddleware` (P5.2). The role is granted
  through the SOC2 emergency-access list (not via self-signup).
- **`OWNER`** / **`ADMIN`** — tenant-scoped; `@Roles('OWNER','ADMIN')`
  on the audit-log read endpoint, billing, plan-mgmt, tenant mgmt.
- **`HR_MANAGER`** / **`ACCOUNTANT`** / **`MANAGER`** — domain-scoped
  middle roles (P3.1 onwards). They get `read/create/update` but not
  namespaced admin verbs (`tenant.manage`, `user.manage`,
  `billing.manage`).
- **`MEMBER`** — workspace-write access (own rows). No admin verbs.
- **`VIEWER`** — read-only across the workspace surface.

The global `RolesGuard` enforces every `@Roles(...)` decorator with
`roles.guard.ts` and short-circuits on `SUPER_ADMIN` so a confused
role hierarchy never denies the break-glass account.

### Plan-gated (`@RequiresFeature` — P3.1)

A subset of controllers declare a *plan feature* requirement
independent of the role:

| Endpoint | Required feature |
|---|---|
| `/crm/*`         | `crm` |
| `/erp/*`         | `erp` |
| `/bi/*`          | `bi` |
| `/hr/*`          | `hr.employees` / `hr.leave` / `hr.attendance` / `hr.payroll` |
| `/docs/templates`| `docs` |
| `/projects`      | `projects` |

When a tenant lacks the feature, every controller returns the same
stable 403 body so the FE can render an upgrade modal (P3.4):

```json
{ "error": "FEATURE_NOT_INCLUDED", "feature": "crm", "planId": "..." }
```

The Feature Gate uses a Redis-cached entitlement map
(`apps/api/src/common/entitlements/`) that is invalidated whenever a
plan changes (P3.3's pub/sub). The cache TTL is 60 s for defence
against Redis outages.

## Sensitive surfaces (non-HTTP)

### Authentication

| Control | Where | Notes |
|---|---|---|
| bcrypt cost 12 | `apps/api/src/modules/auth/auth.service.ts` | `bcrypt.hash(data, 12)` |
| JWT secret | `process.env.JWT_SECRET` | env-injected; never in repo |
| JWT algorithm | `JwtModule` config | explicit `HS256` + audience claim |
| MFA secret | `MfaFactor.secret` | stored bcrypt-hashed server-side |
| Recovery codes | `MfaFactor.backupCodes` | bcrypt-hashed; one-time-use |
| Sessions | `RefreshToken` | server-side row; rotation on use |

### Authorization

| Control | Where |
|---|---|
| RBAC | `@Roles()` decorator + `RolesGuard` (global `APP_GUARD`) |
| Tenant scoping | `TenantContextMiddleware` → AsyncLocalStorage |
| Plan gating | `@RequiresFeature` decorator + `FeatureGateGuard` (P3.1) |
| Postgres RLS | enabled on every tenant-scoped table |
| WORM audit chain | trigger + `previousSignature` chain (P5.2) |
| JWT replay protection | jti blacklists expired tokens for 7 days |

### Data protection

| Layer | Control |
|---|---|
| At-rest (DB) | provider-managed disk encryption (AWS RDS / GCP Cloud SQL / Azure DB) |
| At-rest (object storage) | S3-compatible SSE + bucket versioning + Object Lock (P5.2) |
| At-rest (secrets) | Kubernetes `Secret` (or HashiCorp Vault in self-hosted Helm) |
| In-transit (egress) | TLS 1.3 at LB/ingress (Cert-manager + Let's Encrypt) |
| In-transit (cluster) | mTLS via Linkerd in production (optional, opt-in) |
| Field-level redaction | `apps/api/src/common/audit/audit-redactor.ts` (password, token, jwt, etc.) |
| Chain integrity | HMAC-SHA256 on every audit row (P5.2) |

### Rate limiting & abuse

| Layer | Control |
|---|---|
| Edge (LB) | 100 req / s / IP (Cloudflare or NGINX ingress) |
| API | `@nestjs/throttler` per-IP 10 req / s on `/auth/*` (login, MFA, signup) |
| Webhook | per-event idempotency keyed by `stripeEventId` (P4.1) |
| Body cap | `MAX_BODY_BYTES = 32 KiB` in `audit.middleware.ts` |
| Response cap | 32 KiB on captured `after`, `{"_truncated": true, "size": N}` otherwise |
| Audit log | truncated bodies still get recorded (the hash of the truncated shape is reproducible) |

### MFA

| Surface | Control |
|---|---|
| Enrollment | TOTP via otplib; QR rendered once at enrollment (`/api/auth/mfa/enroll`) |
| Verification | 6-digit TOTP (window ±1 step) or bcrypt-hashed recovery code |
| Lockout | exponential backoff after 5 failed attempts (10s → 5min cap) |
| Recovery codes | 10 generated, bcrypt-hashed, one-time-use (`MfaService.verify()`) |

## P5.2 — Daily WORM snapshot (SOC2 CC6.1 + CC9.2)

The single biggest change in v2.0.0 versus v1.0.0 for SOC2 is the
audit-log WORM chain. The control is implemented at three layers and
each is described below; auditors validate by replaying the daily S3
snapshot against the live DB with `prisma/scripts/audit-snapshot.ts`'s
embedded verifier.

### Layer 1 — DB-level append-only enforcement

The migration `prisma/migrations/20260706150000_v2_p5_2_audit_worm/migration.sql`
adds three triggers and three columns.

```sql
-- New columns:
ALTER TABLE "AuditLog"
  ADD COLUMN "signature"          TEXT,
  ADD COLUMN "previous_signature" TEXT,
  ADD COLUMN "signed_at"          TIMESTAMP(6);

-- Triggers:
CREATE TRIGGER audit_log_no_update   BEFORE UPDATE   ON "AuditLog" ...
CREATE TRIGGER audit_log_no_delete   BEFORE DELETE   ON "AuditLog" ...
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog" ...
```

All three call `audit_log_worm_block()` which raises:

```
AuditLog is append-only (WORM): UPDATE on row … is not permitted
SQLSTATE: P0001
```

This blocks UPDATE/DELETE/TRUNCATE regardless of the connecting role
(belt-and-suspenders against a SUPERUSER-grant mistake). It also
returns a stable error code so the application surfaces
"AuditLog is append-only (WORM)" instead of a generic "permission
denied".

The migration also revokes UPDATE/DELETE/TRUNCATE on `AuditLog` from
the `omyxia_app` role when present (best-effort, idempotent).

### Layer 2 — Per-row HMAC chain

The audit middleware (`apps/api/src/common/audit/audit.middleware.ts`)
populates `signed_at` and `previous_signature` per row using a
process-local chain-head cache. The off-band signature is computed
in `prisma/scripts/audit-snapshot.ts` (the canonical place where the
full row + chain head are observable after-the-fact) and stored as a
sibling `.sig.jsonl.gz` object in S3.

```
message   = v1:<previous_signature>:<canonical(json(row, sorted_keys))>
signature = HMAC_SHA256(AUDIT_HMAC_SECRET, message)
```

- **Domain-separation tag** (`v1:`) lets us upgrade the signature
  algorithm later without colliding with old chains.
- **Per-tenant chains** — each tenant (and the cross-tenant
  super-admin bucket) maintains an independent previous-signature
  thread. Re-ordering or row loss inside one tenant doesn't
  invalidate other tenants' chains.
- **Constant-time verify** — `verifyAuditRow()` uses
  `crypto.timingSafeEqual()` so a brute-force attack against a
  known row cannot be distinguished by timing.

### Layer 3 — Daily S3 Object-Lock snapshot (CronJob)

The Helm chart ships a `CronJob` (`helm/omyxia/templates/audit-snapshot-cronjob.yaml`)
that runs at 02:30 UTC every day. It boots the API image, runs
`prisma/scripts/audit-snapshot.ts`, and pushes:

```
s3://<AUDIT_S3_BUCKET>/audit-log/<YYYY-MM-DD>/
  audit-<stamp>.jsonl.gz          ← canonical signed rows (one JSON per line)
  audit-<stamp>.sig.jsonl.gz      ← per-row signatures (id, signature, previousSignature)
  manifest-<stamp>.json           ← SHA-256 of the two files + metadata
```

Every PUT sets `ObjectLockMode=COMPLIANCE` and
`ObjectLockRetainUntilDate=now + 2555 days` (7 years). The bucket
itself must be created **once at provision time** with Object Lock
*Enabled* (a one-time, irrevocable setup). This is the SOC2 CC6.1
"logical access controls over protected information assets" control
that auditors want to see — even the bucket owner cannot delete or
rewrite a locked object for the retention period.

```bash
# Manual re-run + verify
kubectl create job --from=cronjob/omyxia-audit-snapshot audit-manual
# Download & verify:
aws s3 cp s3://$BUCKET/audit-log/2026-07-06/audit-20260706T023000Z.jsonl.gz ./audit.jsonl.gz
gunzip audit.jsonl.gz
node -e "
  const { verifyChain } = require('./prisma/scripts/audit-snapshot.ts');
  const fs = require('fs');
  const result = verifyChain(fs.readFileSync('audit.jsonl','utf8'), process.env.AUDIT_HMAC_SECRET);
  console.log(result);
"
```

### Failure modes (what auditors test)

| Scenario | Detection | Recovery |
|---|---|---|
| Attacker deletes an audit row in the live DB | `audit_log_no_delete` trigger raises; row count mismatch in next snapshot | Snapshot is the source of truth; replay and reconcile |
| Attacker modifies a row in place | Per-row HMAC fails on the `.sig.jsonl.gz` chain | Same as above |
| Attacker re-orders rows | Per-tenant chain head breaks at the re-order point | Same as above |
| Attacker rewrites the S3 bucket | Object Lock COMPLIANCE refuses (their IAM token lacks `s3:BypassGovernanceRetention`) | Legal hold + new bucket |
| `AUDIT_HMAC_SECRET` leaks | Rotated via secret-management; old chains remain verifiable, new chains adopt new secret | `signature` column carries a `v1:` prefix to ease rotation |
| Snapshot CronJob is delayed / fails | `failedJobsHistoryLimit: 30` and a Slack alert in production | Re-run manually via `POST /admin/audit/snapshot/run` |

## Hardening checklist (v2.0.0)

### Application

- [x] bcrypt 12 rounds (`apps/api/src/modules/auth/auth.service.ts`)
- [x] JWT explicit algorithm + audience claim
- [x] All RBAC endpoints require `@Roles()` (see RBAC_MATRIX.md)
- [x] All plan-gated endpoints use `@RequiresFeature` (P3.1)
- [x] Field-level redaction in audit log (passwords, tokens, jwt, …)
- [x] WORM chain trigger on AuditLog (P5.2)
- [x] Per-row HMAC + chain integrity (P5.2)
- [x] Daily S3 Object-Lock snapshot + 7y retention (P5.2)
- [x] Idempotent webhooks (Stripe P4.1)
- [x] RLS on every tenant-scoped table

### Infrastructure

- [x] TLS 1.3 at ingress (cert-manager)
- [x] mTLS within cluster (Linkerd opt-in)
- [x] Postgres TDE (provider-managed)
- [x] S3 bucket versioning + Object Lock = Enabled (one-time provisioning)
- [x] Kubernetes secrets encrypted at rest (KMS / Vault)
- [x] Non-root containers + read-only root filesystem on the CronJob
- [x] Network policies deny egress except to DB / Redis / S3 / Stripe
- [x] Pod Security Standards `restricted` profile (Helm chart default)

### Operations

- [x] Daily WORM snapshot CronJob + PagerDuty alert on failure
- [x] Hourly DB backup + 7-day point-in-time restore window
- [x] Quarterly WORM integrity replay (`scripts/audit-snapshot verify`)
- [x] DR runbook (`docs/runbooks/DISASTER_RECOVERY.md`) tested annually
- [x] Incident response runbook (`docs/security/INCIDENT_RESPONSE.md`)
- [x] Data retention schedule (`docs/security/DATA_RETENTION.md`)

## Self-host hardening

For self-hosted installations, the AWS S3 Object Lock + KMS combo can
be replicated with:

- **MinIO** (`MINIO_DOMAIN=audit.omyxia.local`) with
  `mc admin config` enabling Object Lock + retention
  [WORM](https://min.io/docs/minio/linux/administration/object-lock.html).
- **Backblaze B2** with native Object Lock on the `audit-log` bucket.
- **Wasabi** with bucket default retention (no Object Lock, but
  similar immutability).

In every case the daily CLI's HMAC chain still gives you offline
verifiability even if the bucket's immutability story drifts.
