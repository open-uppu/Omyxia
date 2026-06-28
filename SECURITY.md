# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

The open-uppu team takes security seriously. We appreciate your efforts to responsibly disclose vulnerabilities.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Send your report privately to: **[security@openuppu.example](mailto:security@openuppu.example)**

Include as much of the following as possible:

- Type of vulnerability (e.g., SQL injection, XSS, auth bypass)
- Affected component(s) (e.g., `@omyxia/api`, `@omyxia/web`, Prisma schema)
- Steps to reproduce
- Proof-of-concept code (if available)
- Impact assessment (what an attacker could gain)
- Your name/handle (for credit in the security advisory, optional)

### What to Expect

| Phase | Timeline |
|---|---|
| Initial acknowledgment | within 48 hours |
| Triage + severity assessment | within 7 days |
| Fix development (depends on severity) | 1-30 days |
| Security advisory publication | after fix is released |

We follow [Coordinated Vulnerability Disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure) principles.

## Security Architecture

Omyxia is built with **defense-in-depth** multi-tenant isolation:

### Layer 1 — Database (PostgreSQL RLS)

Every tenant-scoped table has `ENABLE ROW LEVEL SECURITY` + a policy that filters by `current_tenant_id()`. Cross-tenant reads/writes are blocked **at the database**, even if application code has bugs.

### Layer 2 — ORM (Prisma)

Every query auto-scoped by `tenantId` via `TenantContextService` middleware. The middleware reads the tenant from the JWT and injects it into every Prisma call.

### Layer 3 — Application (NestJS guards)

JWT validation, role-based access control (CASL), and per-request tenant context. Tokens are short-lived (15 min access + 7 day refresh).

### Layer 4 — Infrastructure

- TLS 1.3 enforced on all endpoints
- bcrypt(12) password hashing (OWASP recommended)
- MFA support via TOTP
- Audit log for all sensitive operations
- Secrets managed via env vars (never in source)

## Threat Model

We explicitly consider these threats:

| Threat | Mitigation |
|---|---|
| Cross-tenant data leak | RLS + tenant middleware (defense-in-depth) |
| SQL injection | Prisma parameterized queries (no raw SQL except in migrations) |
| XSS | React (auto-escapes) + CSP headers |
| CSRF | SameSite cookies + double-submit tokens |
| Auth bypass | JWT signature verification + exp validation |
| Privilege escalation | RBAC (CASL) + role checks at controller level |
| Secrets in source | `.env` gitignored + pre-commit secret scanning |
| Supply chain | pnpm lockfile committed + Dependabot |
| DoS | Rate limiting (per-IP + per-tenant) + queue backpressure |

## Hall of Fame

We thank the following security researchers for responsible disclosures:

_(none yet — be the first!)_

## Acknowledgments

This security policy was inspired by:

- [GitHub Security Lab](https://securitylab.github.com/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CVE.org](https://cve.mitre.org/)