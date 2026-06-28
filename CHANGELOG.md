# Changelog

All notable changes to Omyxia will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Real-DB integration guard (`test/integration/schema-drift.integration-spec.ts`) — 5 tests
- E2E smoke test for Health module (`test/e2e/health.e2e-spec.ts`)
- Vitest configs for unit + e2e + integration tiers
- Next.js 15 frontend scaffold (`apps/web/`)
- ESLint configuration for `apps/api/` and `apps/web/`
- `CONTRIBUTING.md`, `LICENSE` (AGPL-3.0), `SECURITY.md`

### Fixed
- **Schema-vs-services drift (46 TS errors → 0):**
  - Regenerated `schema.prisma` from live Postgres (DB is source of truth)
  - Corrected relation names (PascalCase): `customer` → `Customer`, `account` → `ChartOfAccounts`, `sender` → `User`, etc.
  - Corrected field names: `sizeBytes` → `sizebytes` (BigInt), `to` → `toAddresses` (array), etc.
  - Added enum casts for `AccountType`, `TaxType`, `NormalBalance`
  - Restructured auth signup flow (User → UserTenant → Tenant)
  - Fixed `tenantId_userId` unique key usage
  - Removed unsupported `children`/`department`/`owner` includes (not in DB)
- `auth.service.ts` import path (`../common/...` → `../../common/...`)
- Root `db:migrate` script (called wrong sub-script)
- `prisma/package.json` `db:seed` path (`prisma/seed.ts` → `seed.ts`)
- Missing `migration_lock.toml` in `prisma/migrations/`
- Missing `@types/bcryptjs` for `seed.ts`
- Missing `dotenv-cli` for env loading in seed
- Missing `health.module.ts` (Health controller had no module)
- Created `tsconfig.json` for `prisma/` to enable `ts-node`

### Migration
- **0005_align_schema_services** — adds `Employee.baseSalary`, `EmailMessage.{folder,from,body,receivedAt,isRead}`, `EmailTemplate.{code,body}`

## [0.1.0] - 2026-06-28

### Added
- Initial release of Omyxia — Multi-tenant Enterprise IT Master Blueprint (SaaS)
- **64 database models** across 14 business domains
- **NestJS 10 backend** with 13 modules:
  - CRM (pipeline, leads, activities)
  - ERP (GL, AP, AR, tax, chart of accounts, fiscal periods)
  - HRM (employees, departments, positions, leave, payroll, attendance)
  - Workspace (email, chat, files)
  - Specialized (WMS, SRM, PMS, DMS, FMS, ITSM, FRM, backup, endpoint security)
  - Governance (BI, KPI, consent, cookie consent, data subject requests, breach incidents)
- **PostgreSQL 16** with **Row-Level Security** for multi-tenant isolation
- **Prisma 5** ORM with auto-generated types
- **Next.js 15** frontend (scaffold)
- **Thai defaults** — chart of accounts (12) + tax rates (VAT 7%, WHT 1/2/3/5%)
- **Demo seed** — `acme-th-demo` tenant with admin user
- **Unit test coverage** — 47 tests across api + shared-types + web
- **Docker Compose** — Postgres + Redis + MinIO + Stalwart

[Unreleased]: https://github.com/open-uppu/omyxia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/open-uppu/omyxia/releases/tag/v0.1.0