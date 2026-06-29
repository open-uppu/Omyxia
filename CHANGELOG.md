# Changelog

All notable changes to Omyxia will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Project Management + Document Templates (Phase E / v0.3.1)** — minimal viable
  project + document-template surface for tenant-scoped productivity
  - New backend controllers: `ProjectsController` (`/projects`) and
    `DocumentTemplatesController` (`/docs/templates`) registered in
    `SpecializedModule`. Project CRUD includes nested tasks
    (`GET/POST/PATCH/DELETE /projects/:id/tasks[/:taskId]`).
  - New `DocumentTemplatesService` with a `POST /docs/templates/:id/render`
    endpoint. Renders HTML templates with `{{var}}` (escaped) and
    `{{{var}}}` (sanitized raw) placeholders. Variable names must match
    `[a-zA-Z_][a-zA-Z0-9_]{0,63}`; unknown names render empty.
  - Render security: `escapeHtml`, `sanitizeRawHtml` (strips
    `<script>`/`<iframe>`/`<object>`/`<embed>`/`<form>`/`<style>` blocks,
    `on*=` handlers, and `javascript:`/`vbscript:`/`data:text/html` URLs).
    Each value is clamped to 16 KiB.
  - Field whitelisting in services — bodies can never overwrite
    `tenantId`, `id`, `createdAt`, or `updatedAt`.
  - 61 new Vitest unit tests (projects + document-templates + render
    helpers) — 99.25 % stmt / 92.22 % branch coverage on the new files.
  - Frontend pages (`/projects`, `/projects/:id`, `/docs/templates`,
    `/docs/templates/:id`) wired through a typed `api.projects.*` /
    `api.templates.*` client. The renderer previews in a sandboxed
    iframe so raw HTML never reaches our React tree.
  - 43 new frontend tests (ProjectsList, ProjectDetail,
    DocumentTemplatesList, TemplateRenderer) — 97.32 % stmt / 83.83 %
    branch coverage on the new components.
  - Test totals: 192 → **361** (api 253 + web 108).
- **File upload + MinIO (Phase D)** — S3-compatible object storage wired into the Workspace `files` surface via presigned URLs
  - `StorageModule` (global) wraps the existing `StorageService` (uses
    `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; same code path
    works against MinIO and AWS S3 — `forcePathStyle: true`, region
    `us-east-1`, env-driven endpoint + credentials)
  - `FilesService` now issues presigned PUT URLs (`POST /files/presign`),
    accepts a finalize call (`POST /files/:id/finalize` that pulls the
    server-side size via `HeadObject`), and returns presigned GET URLs
    (`GET /files/:id`). Delete (`DELETE /files/:id`) removes both the
    row and the S3 object.
  - Tenant-scoped storage keys: `<tenantId>/<folderId|root>/<yyyy>/<mm>/<rand>-<safeName>`,
    with a `..`/slash collapse guard that keeps the leaf inside the tenant prefix.
  - All endpoints require auth + tenant scope (enforced by the existing
    `TenantContextMiddleware` + `RolesGuard`). Role gates: presign/finalize/download
    = `OWNER`/`ADMIN`/`MANAGER`/`MEMBER`; delete = `OWNER`/`ADMIN`.
  - 22 unit tests in `files.service.spec.ts` (context guard, key
    generation, sanitisation, finalize size reconciliation, tenant-scoped
    404s, TTL cap, delete cleanup)
  - 15 unit tests in `storage.service.spec.ts` (bucket probe, presign,
    head/metadata, getMetadata NotFound, getClient/getBucketName accessors)
  - 5 e2e tests in `test/e2e/files.e2e-spec.ts` (boots, full happy path,
    cross-tenant 404, delete cleanup, TTL cap)
- **Real-time chat (Phase C)** — `@nestjs/websockets` + `socket.io` under `/realtime` namespace
  - JWT handshake gate (`RealtimeGateway`): accepts `auth.token` or `query.token`,
    joins `user:<id>` + `tenant:<id>` rooms, auto-joins every chat channel the
    user is a member of, marks online via `PresenceService` (Redis), and
    broadcasts `presence:online` to the tenant room
  - `presence:heartbeat` refreshes the Redis TTL
  - Disconnect marks offline and broadcasts `presence:offline`
  - `ChatGateway` (`chat:message`): membership re-check (defence in depth
    alongside the REST controller), trims + length-caps content, persists via
    the existing `ChatService.sendMessage` inside an explicit
    `TenantContextService.run`, then broadcasts `chat:message:new` (and the
    legacy `chat:message`) to the channel room
  - 12 unit tests in `realtime.gateway.spec.ts` (auth gate, handshake, room
    joining, presence lifecycle, heartbeat, whoami)
  - 8 unit tests in `chat.gateway.spec.ts` (validation, membership guard,
    cross-tenant guard, happy path, parentId passthrough)
  - E2E module-boot smoke test in `test/e2e/realtime.e2e-spec.ts`
- Real-DB integration guard (`test/integration/schema-drift.integration-spec.ts`) — 5 tests
- E2E smoke test for Health module (`test/e2e/health.e2e-spec.ts`)
- Vitest configs for unit + e2e + integration tiers
- Next.js 15 frontend scaffold (`apps/web/`)
- ESLint configuration for `apps/api/` and `apps/web/`
- `CONTRIBUTING.md`, `LICENSE` (AGPL-3.0), `SECURITY.md`

### Fixed
- Typo in `src/realtime/events.ts` ServerEvents map:
  `'auth:success': (payload: AuthSuccess: AuthSuccessPayload)` ->
  `payload: AuthSuccessPayload`

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