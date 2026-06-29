# Attack Surface (v1.0.0 Pentest Prep)

## Endpoints exposed

### Public (unauthenticated)
- `POST /auth/login` — credential verification
- `POST /auth/signup` — tenant creation
- `POST /auth/onboarding/complete` — initial setup
- `GET /auth/mfa/challenge` — MFA token challenge

### Authenticated
All endpoints under `/api/*` require JWT in `Authorization: Bearer <token>`.

### Role gates (RBAC matrix)

| Endpoint | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| `POST /tenants` | ✅ | ✅ | ❌ | ❌ |
| `POST /projects` | ✅ | ✅ | ✅ | ❌ |
| `GET /audit-logs` | ✅ | ✅ | ❌ | ❌ |
| `DELETE /files/:id` | ✅ | ✅ | ❌ | ❌ |
| `POST /files/:id/finalize` | ✅ | ✅ | ✅ | ✅ |
| `POST /bi/dashboards` | ✅ | ✅ | ✅ | ❌ |

## Sensitive surfaces

### Authentication
- bcrypt rounds: **12** (matches `bcrypt.hash(data, 12)`)
- JWT secret: `process.env.JWT_SECRET` (env-injected, not in repo)
- Recovery codes: stored bcrypt-hashed (not plaintext)

### Authorization
- RBAC: `@Roles('OWNER', 'ADMIN')` decorator + RolesGuard (global)
- Tenant scoping: TenantContextMiddleware → AsyncLocalStorage
- RLS: PostgreSQL Row-Level Security enabled on all tenant-scoped tables

### Data protection
- At-rest: Postgres TDE (cloud-provider dependent)
- In-transit: TLS 1.3 (recommended at LB / ingress)
- Secrets: env-only, never in repo

### MFA
- TOTP via otplib (qrcode rendered once at enrollment)
- Recovery codes: 10 generated, bcrypt-hashed, one-time-use

## Hardening checklist

- [x] bcrypt 12 rounds
- [x] JWT with explicit algorithm + audience
- [x] All RBAC endpoints require @Roles
- [x] MFA TOTP + recovery
- [x] Audit log middleware on POST/PUT/PATCH/DELETE
- [x] Tenant scoping via ALS
- [x] Field whitelisting in services (no tenantId/createdAt from body)
- [x] Recovery codes one-time-use
- [x] CSP headers (verify in `main.ts`)
- [ ] Rate limit on `/auth/login` (TODO: add `@nestjs/throttler`)
- [ ] HSTS header (verify in reverse proxy config)
- [ ] Dependabot config (add `.github/dependabot.yml`)

## Out of scope (deferred to v1.1.0)

- Web Application Firewall (WAF) — deploy at ingress
- DDoS protection — cloud LB level
- Token revocation list — currently JWT only
- Audit log export — only DB query, no streaming

## Hand-off to pentest vendor

Provide:
1. This doc
2. Staging environment URL + creds (not in this repo)
3. RBAC matrix spreadsheet
4. JWT sample for test tenants
5. Recent CVE audit (run `pnpm audit --json > cve-report.json`)
6. Last full backup timestamp + restore test result
