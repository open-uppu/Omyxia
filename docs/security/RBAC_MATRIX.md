# RBAC Permission Matrix (v2.0.0)

> **Generated from:** `apps/api/src/modules/auth/rbac/roles.ts`,
> `apps/api/src/common/auth/rbac/permissions.ts`, and the per-controller
> `@Roles(...)` decorators across all v2.0.0 modules (audit logs are not
> RBAC-gated in this doc; see [ATTACK_SURFACE.md](./ATTACK_SURFACE.md) for
> the audit pipeline).
>
> **How to read this matrix.** Every endpoint lists the **explicit role
> allow-list** declared by its `@Roles(...)` decorator. The wildcards
> (`*`) and inheritance rules from `PERMISSIONS` in `roles.ts` are then
> applied: `SUPER_ADMIN` always passes; `OWNER` and `ADMIN` inherit the
> four CRUD verbs (`read`, `create`, `update`, `delete`) plus
> namespaced admin verbs (`audit.read`, `tenant.manage`,
> `user.manage`, `billing.manage`).
>
> **SOC2 scope.** This document is the authoritative answer to SOC2 CC6.1
> ("the entity implements logical access security software, infrastructure,
> and architectures over protected information assets") and CC6.3
> ("the entity authorizes, modifies, or removes access to data,
> software, and infrastructure"). Every protected endpoint in v2.0.0 is
> listed here with its allow-list, and additions/changes are picked up
> by the [P5.2 WORM audit log](#p52-worm-audit-log-impact) so a
> permission change leaves a tamper-evident record.

## Role hierarchy

```
SUPER_ADMIN  >  OWNER  >  ADMIN  >  HR_MANAGER / ACCOUNTANT / MANAGER  >  MEMBER  >  VIEWER
```

`SUPER_ADMIN` is an **internal, break-glass** role. It is held only by
the Omyxia engineering on-call rota, the SOC2 emergency-access list,
and the auditor service-account. From a UX standpoint, every interaction
is mediated by the admin console at `admin.omyxia.app` (P2.1) which
logs every super_admin action to the WORM audit log (P5.2).

## Permission semantics

The permission system is a **role × action** matrix, not a "deny-list"
or "type-based" model. Eight roles × nine actions:

| Action verb | Implied by `manage`? | Granted to |
|---|---|---|
| `read`, `create`, `update`, `delete` | ✅ yes | All roles except `VIEWER` (read-only) |
| `manage` (legacy coarse verb)        | (it IS the verb)   | `OWNER`, `ADMIN` |
| `audit.read`                         | ❌ no | `OWNER`, `ADMIN` (super-admin can always read) |
| `tenant.manage`                      | ❌ no | `OWNER` (and super-admin) |
| `user.manage`                        | ❌ no | `OWNER`, `ADMIN` |
| `billing.manage`                     | ❌ no | `OWNER` (and super-admin) |
| `*`                                  | (everything)       | `SUPER_ADMIN` only |

`MEMBER` can `create`/`update` their own workspace entities (positions,
attendance, projects, files, chat messages, mailbox drafts). `VIEWER`
is read-only across the same surface. `MANAGER / HR_MANAGER /
ACCOUNTANT` are domain-scoped middle roles that exist for v2.0.0
so the FE can hide parts of the sidebar (`@RequiresFeature`,
P3.1) without changing the role taxonomy.

## Global guards

Two global guards are registered as `APP_GUARD` in `apps/api/src/app.module.ts`:

- **`JwtAuthGuard`** — every `/api/*` route requires an `Authorization:
  Bearer <jwt>` header. Public endpoints (`/api/auth/login`,
  `/api/auth/signup`, `/api/auth/onboarding/complete`,
  `/api/auth/mfa/challenge`) are explicitly marked `@Public()`.
- **`RolesGuard`** — every endpoint with `@Roles(...)` rejects users
  whose JWT role is not in the allow-list. Endpoints WITHOUT `@Roles()`
  are open to any authenticated user on the same tenant; rate limiting
  is applied per-IP at the ingress, not here.

The per-tenant scoping is enforced by `TenantContextMiddleware` →
`AsyncLocalStorage` → Prisma, **before** any tenant-scoped query
runs. Cross-tenant writes are impossible by construction.

## Endpoint × Role allow-list

`X` = allowed; blank = denied. `SUPER_ADMIN` always wins (not shown on
every row). The "billing" entries document the new v2.0.0 Stripe module
(P4.1). The "feature-gate" entries document the new v2.0.0
`@RequiresFeature` decorator (P3.1) — the column on the right is the
**required plan feature**, separate from the role allow-list.

### Auth + Tenancy

| Endpoint | OWNER | ADMIN | HR_MANAGER | ACCOUNTANT | MANAGER | MEMBER | VIEWER |
|---|---|---|---|---|---|---|---|
| `POST /auth/login` (public) | X | X | X | X | X | X | X |
| `POST /auth/signup` (public) | X | X | X | X | X | X | X |
| `POST /auth/onboarding/complete` (public) | X | X | X | X | X | X | X |
| `GET /auth/mfa/challenge` (public) | X | X | X | X | X | X | X |
| `POST /tenants`            | X | X |   |   |   |   |   |
| `PATCH /tenants/:id`       | X | X |   |   |   |   |   |
| `DELETE /tenants/:id`      | X |   |   |   |   |   |   |
| `POST /tenants/:id/switch` | X | X | X | X | X | X |   |
| `GET  /tenants/:id`        | X | X | X | X | X | X | X |

### Workspace (Mail / Files / Chat / Projects / Documents)

| Endpoint | OWNER | ADMIN | HR_MANAGER | ACCOUNTANT | MANAGER | MEMBER | VIEWER | Required feature |
|---|---|---|---|---|---|---|---|---|
| `GET    /mail/templates`        | X | X | X | X | X | X | X | — |
| `POST   /mail/templates`        | X | X | X |   |   |   |   | — |
| `POST   /mail/send`             | X | X | X | X | X | X |   | — |
| `GET    /files/:id`             | X | X | X | X | X | X | X | — |
| `POST   /files/presign`         | X | X | X | X | X | X |   | — |
| `POST   /files/:id/finalize`    | X | X | X | X | X | X | X | — |
| `DELETE /files/:id`             | X | X |   |   |   |   |   | — |
| `GET    /chat/channels`         | X | X | X | X | X | X | X | — |
| `POST   /chat/channels/:id/messages` | X | X | X | X | X | X |   | — |
| `GET    /projects`              | X | X | X | X | X | X | X | — |
| `POST   /projects`              | X | X | X |   | X | X |   | — |
| `PATCH  /projects/:id`          | X | X | X |   | X |   |   | — |
| `DELETE /projects/:id`          | X | X |   |   |   |   |   | — |
| `POST   /projects/:id/tasks`    | X | X | X |   | X | X |   | — |
| `PATCH  /projects/:id/tasks/:tid`| X | X | X |   | X |   |   | — |
| `DELETE /projects/:id/tasks/:tid`| X | X | X |   | X |   |   | — |
| `GET    /docs/templates`        | X | X | X | X | X | X | X | `docs` |
| `POST   /docs/templates`        | X | X |   |   |   |   |   | `docs` |
| `PATCH  /docs/templates/:id`    | X | X |   |   |   |   |   | `docs` |
| `DELETE /docs/templates/:id`    | X | X |   |   |   |   |   | `docs` |
| `POST   /docs/templates/:id/render` | X | X | X | X | X | X | X | `docs` |

### CRM

| Endpoint | OWNER | ADMIN | MANAGER | MEMBER | VIEWER | Required feature |
|---|---|---|---|---|---|---|
| `*  /crm/pipelines`  | X | X | X | X | X (read) | `crm` |
| `*  /crm/leads`      | X | X | X | X | X (read) | `crm` |
| `*  /crm/activities` | X | X | X | X | X (read) | `crm` |

### ERP (GL/AP/AR/Tax/FiscalPeriod)

| Endpoint | OWNER | ADMIN | ACCOUNTANT | MANAGER | MEMBER | VIEWER | Required feature |
|---|---|---|---|---|---|---|---|
| `* /erp/chart-of-accounts` | X | X | X |   |   |   | `erp` |
| `* /erp/journals`          | X | X | X |   |   |   | `erp` |
| `* /erp/fiscal-periods`    | X | X | X |   |   |   | `erp` |
| `* /erp/taxes`             | X | X | X |   |   |   | `erp` |
| `* /erp/ar/invoices`       | X | X | X |   |   |   | `erp` |
| `* /erp/ap/bills`          | X | X | X |   |   |   | `erp` |

### HR / Payroll / Leave / Attendance / Positions

| Endpoint | OWNER | ADMIN | HR_MANAGER | MANAGER | MEMBER | VIEWER | Required feature |
|---|---|---|---|---|---|---|---|
| `* /hr/employees`        | X | X | X | X (team-scoped) |   |   | `hr.employees` |
| `* /hr/positions`        | X | X | X | X (team-scoped) |   |   | `hr.employees` |
| `* /hr/departments`      | X | X | X | X | X (read) | X (read) | — |
| `* /hr/leave`            | X | X | X | X | X (own) |   | `hr.leave` |
| `* /hr/attendance`       | X | X | X | X | X (own) |   | `hr.attendance` |
| `* /hr/payroll`          | X | X | X |   |   |   | `hr.payroll` |

### BI / Governance

| Endpoint | OWNER | ADMIN | HR_MANAGER | ACCOUNTANT | MANAGER | MEMBER | VIEWER | Required feature |
|---|---|---|---|---|---|---|---|---|
| `GET    /bi/dashboards`     | X | X | X | X | X | X | X | `bi` |
| `POST   /bi/dashboards`     | X | X | X | X | X | X |   | `bi` |
| `*      /governance/cmp`    | X | X |   |   |   |   |   | — |
| `*      /search`            | X | X | X | X | X | X | X | — |

### Audit (P5.2 WORM upgrade)

| Endpoint | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| `GET /audit-logs`                | X | X |   |   |
| `GET /audit-logs/:id`            | X | X |   |   |
| `POST /admin/audit/snapshot/run` | — | — | — | — (super-admin only; see Admin section) |
| `GET  /admin/audit/integrity`    | — | — | — | — (super-admin only) |

> The two new admin endpoints above are **POST /admin/audit/snapshot/run**
> and **GET /admin/audit/integrity**, both gated with
> `@Roles('SUPER_ADMIN')`. They are the only way to (a) trigger an
> ad-hoc WORM snapshot outside the 24-h CronJob and (b) re-verify the
> chain integrity on demand (e.g. during a SOC2 audit).

### Admin Console (admin.omyxia.app) — P1.4…P5.1 (cross-tenant)

> These endpoints are **super-admin only**. The `@Roles('SUPER_ADMIN')`
> guard returns 403 for any other token, regardless of tenant context.
> The actor's id is propagated into the WORM audit log via
> `superAdminId` and the impersonated tenant (when applicable) via
> `targetTenantId`.

| Endpoint | SUPER_ADMIN | Required prereq |
|---|---|---|
| `GET    /admin/tenants`              | X | P1.4 |
| `POST   /admin/tenants`              | X | P1.5 |
| `PATCH  /admin/tenants/:id`          | X | P1.5 |
| `POST   /admin/tenants/:id/suspend`  | X | P1.6 |
| `POST   /admin/tenants/:id/unsuspend`| X | P1.6 |
| `POST   /admin/tenants/:id/impersonate` | X | P1.7 |
| `POST   /admin/impersonate/end`      | X | P1.7 |
| `GET    /admin/plans`                | X | P3.3 |
| `POST   /admin/plans`                | X | P3.3 |
| `PATCH  /admin/plans/:id`            | X | P3.3 |
| `POST   /admin/plans/:id/add-ons`    | X | P3.3 |
| `DELETE /admin/plans/:id/add-ons/:aid` | X | P3.3 |
| `POST   /admin/tenants/:id/migrate-legacy` | X | P5.1 |
| `POST   /admin/audit/snapshot/run`   | X | P5.2 |
| `GET    /admin/audit/integrity`      | X | P5.2 |

### Billing (Stripe) — P4.1

| Endpoint | Tenant user (≥ MEMBER) | SUPER_ADMIN |
|---|---|---|
| `POST /api/billing/portal`               | X | X |
| `POST /api/billing/checkout`             | X | X |
| `GET  /api/billing/subscription`         | X | X |
| `POST /api/billing/subscription`         | (denied) | X (replaces plan + add-ons) |
| `POST /api/billing/subscription/items`   | (denied) | X |
| `POST /api/billing/subscription/items/remove` | (denied) | X |
| `POST /api/billing/subscription/cancel`  | (denied) | X |
| `POST /api/billing/stripe/webhook`       | (HMAC, public) | (HMAC, public) |

`/billing/subscription*` are tenant-scoped on Stripe Customer IDs, but
the write endpoints (replace / add / remove / cancel) are super-admin
only — customers can self-serve via the Stripe-hosted customer portal
(`/api/billing/portal`) which is the documented self-service path.
The Stripe webhook is unauthenticated by design but verifies the
`Stripe-Signature` HMAC header against `STRIPE_WEBHOOK_SECRET`.

### Failure modes (SOC2 CC7.2)

When an endpoint is denied access the API returns:

| Cause | Status | Body |
|---|---|---|
| Missing JWT on a non-public endpoint | `401 Unauthorized` | `{ error: 'Missing token' }` |
| JWT expired | `401 Unauthorized` | `{ error: 'Token expired' }` |
| JWT role not in `@Roles(...)` | `403 Forbidden` | `{ error: 'Role X not permitted. Required: Y, Z' }` |
| Feature not on tenant's plan | `403 Forbidden` | `{ error: 'FEATURE_NOT_INCLUDED', feature: 'crm' }` (P3.1 stable body) |
| Cross-tenant lookup (RLS would catch it) | `404 Not Found` | Looks identical to a missing row (no info-leak) |
| WORM trigger blocks an admin DB write | `500 Internal` | `{ error: 'AuditLog is append-only (WORM): UPDATE on row …' }` |

P5.2 deliberately refuses to silently coerce any of these into a
generic "Internal Server Error" — auditors want the precise cause.

## P5.2 WORM audit-log impact

Every role-allow-list change is now logged to the WORM audit log
(`apps/api/src/common/audit/audit.middleware.ts`). Specifically, the
permission decision on every `@Roles()`-decorated route is captured
as a CREATE / UPDATE / DELETE audit row. The SOC2-relevant data points
captured are:

- `tenantId`        — the tenant the user was scoped to (NULL for
                       cross-tenant super-admin actions).
- `userId`          — the JWT subject.
- `superAdminId`    — populated when a super-admin action runs.
- `targetTenantId`  — the tenant that owns the row being modified
                       (may differ from `tenantId` when a super-admin
                       is acting cross-tenant).
- `impersonationSessionId` — populated when the action ran under a
                       P1.7 impersonation session (P1.7's row carries
                       both the super-admin id and the impersonated
                       user id).
- `table` / `rowId` — what changed.
- `action`          — CREATE / UPDATE / DELETE (mapped from HTTP verb).
- `before` / `after` — the row diff (redacted through `audit-redactor.ts`).
- `ipAddress`, `userAgent` — the network origin.
- `signature` / `previousSignature` / `signedAt` — P5.2 chain
                       integrity fields (see migration
                       `20260706150000_v2_p5_2_audit_worm`).

Audit rows are immutable after insert because the migration adds a
`BEFORE UPDATE / DELETE / TRUNCATE` trigger that raises an exception
(SQLSTATE `P0001`). The integrity chain is verifiable offline by
re-running the `prisma/scripts/audit-snapshot.ts` verifier with the
same `AUDIT_HMAC_SECRET`. See [ATTACK_SURFACE.md](./ATTACK_SURFACE.md)
for the full control catalog and
[DATA_RETENTION.md](./DATA_RETENTION.md) for retention windows.
