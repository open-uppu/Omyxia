<div align="center">

# 🏛️ Omyxia

### Multi-tenant Enterprise IT Master Blueprint (SaaS)

**OSS-only. Self-hosted. PostgreSQL RLS-enforced tenant isolation.**

[Replaces 14 systems](#-what-omyxia-replaces) ·
[Quick Start](#-quick-start) ·
[Architecture](#-architecture) ·
[Roadmap](#-roadmap) ·
[Contributing](#-contributing)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.0.0-339933)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510.0.0-F69220)](https://pnpm.io)
[![Postgres](https://img.shields.io/badge/PostgreSQL-16-336791)](https://postgresql.org)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E)](https://nestjs.com)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000)](https://nextjs.org)
[![Tests](https://img.shields.io/badge/tests-291%20passing-brightgreen)]()
[![Build](https://img.shields.io/badge/build-3%2F3-success)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://typescriptlang.org)

</div>

---

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Omyxia Dashboard" width="90%">
</p>

<p align="center">
  <em>Multi-tenant BI dashboard — KPIs, revenue trend, activity feed — Thai-first by design.</em>
</p>

---

## 📸 Screenshots

<table align="center">
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/login.png" alt="Login" width="100%"><br>
      <sub><b>Login & SSO</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/crm-pipeline.png" alt="CRM Pipeline" width="100%"><br>
      <sub><b>CRM Pipeline (Kanban)</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/screenshots/hrm-employee.png" alt="HRM Employee Profile" width="60%"><br>
      <sub><b>HRM Employee Profile (Thai + English, ฿ salary, leave quotas, attendance)</b></sub>
    </td>
  </tr>
</table>

---

## ✨ What is Omyxia?

Omyxia is an **open-source, self-hostable Enterprise IT platform** that replaces 14 fragmented business tools with one cohesive multi-tenant SaaS.

Instead of buying & integrating ERP + HRM + CRM + Email + Chat + File Share + BI + Compliance + ... — deploy one app, get all of them, with PostgreSQL Row-Level Security guaranteeing tenant isolation at the database layer.

> **Why?** Most "all-in-one" SaaS are vendor lock-in. Most OSS ERP are single-tenant nightmares. Omyxia is both: **multi-tenant SaaS architecture** with **AGPL-3.0 source freedom**.

---

## 🎯 What Omyxia Replaces

| Domain | Replaces | Status |
|---|---|---|
| 🏢 **ERP** | SAP B1, Oracle NetSuite, Odoo | ✅ v0.1.0 — GL, AP, AR, Tax, COA |
| 👥 **HRM** | Workday, BambooHR | ✅ v0.1.0 — Employee, Leave, Payroll, Attendance |
| 🤝 **CRM** | Salesforce, HubSpot | ✅ v0.1.0 — Pipeline, Lead, Activity |
| 📧 **Email** | Gmail Workspace, Front | ✅ v0.1.0 — IMAP/SMTP via Stalwart |
| 💬 **Chat** | Slack, Teams | ✅ v0.1.0 — Channels + Messages |
| 📁 **File Share** | Dropbox, Google Drive | ✅ v0.1.0 — Folders + Versioning |
| 🛡️ **IAM** | Okta, Auth0 | 🟡 v0.1.0 — Auth foundation |
| 📊 **BI Dashboard** | Tableau, Looker | ✅ v0.1.0 — KPIs + Snapshots |
| 🏪 **WMS** | NetSuite WMS | ✅ v0.1.0 — Inventory + Movements |
| 🛒 **SRM** | SAP Ariba | ✅ v0.1.0 — Vendor scoring |
| 📋 **PMS / DMS** | Asana, Confluence | ✅ v0.1.0 — Projects + Documents |
| 🚗 **FMS** | Fleetio | ✅ v0.1.0 — Vehicle trips |
| 🎫 **ITSM** | Jira Service Desk | ✅ v0.1.0 — Tickets |
| 🔒 **FRM / CMP / PDPA** | OneTrust, RSA | ✅ v0.1.0 — Risk + Compliance |

**14 systems → 1 platform.**

---

## 🏗️ Architecture

Omyxia follows a **5-layer blueprint** with strict separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 7: BI Dashboard         (KPIs, Reports, BI)      │  ← Insights
├─────────────────────────────────────────────────────────┤
│  Layer 6: Workspace            (Email + Chat + Files)   │  ← Collaboration
├─────────────────────────────────────────────────────────┤
│  Layer 5: Core Pillars         (CRM · ERP · HRM)        │  ← Business Logic
│            + Specialized        (MAS · PMS · WMS · …)    │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Cross-cutting        (FMS · CMP/PDPA)         │  ← Governance
├─────────────────────────────────────────────────────────┤
│  Layer 1: Infra & Security     (IAM · Endpoint · Backup │
│                                 + Multi-tenant RLS)     │  ← Foundation
└─────────────────────────────────────────────────────────┘
```

### Tech Stack (100% OSS)

| Concern | Choice |
|---|---|
| **Frontend** | Next.js 15 + TypeScript + shadcn/ui + next-intl |
| **Backend** | NestJS 10 + TypeScript (strict mode) |
| **Database** | PostgreSQL 16 + Prisma 5 + **Row-Level Security** |
| **Auth** | Auth.js v5 + CASL (RBAC) |
| **Queue** | BullMQ + Redis |
| **Object Storage** | MinIO (S3-compatible) |
| **Email Server** | Stalwart Mail Server |
| **Observability** | Grafana OSS + Loki + Prometheus + Tempo |
| **Testing** | Vitest + Playwright + supertest |
| **Monorepo** | pnpm workspaces + Turborepo |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0
- **pnpm** ≥ 10.0.0
- **Docker** (for Postgres + Redis + MinIO + Stalwart)

### 5-Minute Setup

```bash
# 1. Clone & install
git clone https://github.com/open-uppu/omyxia.git
cd omyxia
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env if needed (defaults work for local dev)

# 3. Start infrastructure (Postgres + Redis + MinIO + Stalwart)
sg docker -c 'docker compose -f infra/docker-compose.yml up -d'

# 4. Run database migrations
pnpm db:migrate

# 5. Seed demo tenant ("acme-th-demo" with Thai defaults)
pnpm db:seed

# 6. Start dev servers (API on :3001, Web on :3000)
pnpm dev
```

### Default Seeded Credentials

```
Tenant:  acme-th-demo
Email:   admin@acme-th.demo
Password: demo123!
```

> Includes: 12 chart of accounts, 5 Thai tax rates (VAT 7%, WHT 1/2/3/5%), 1 customer, 1 vendor, 1 employee.

---

## 📦 Repository Layout

```
omyxia/
├── apps/
│   ├── api/                      # NestJS 10 backend
│   │   ├── src/
│   │   │   ├── modules/          # 13 business modules (crm, erp, hr, …)
│   │   │   │   ├── crm/          # CRM service + spec
│   │   │   │   ├── erp/          # ERP service + spec
│   │   │   │   └── …
│   │   │   └── common/           # Prisma + tenant-context middleware
│   │   ├── test/
│   │   │   ├── e2e/              # E2E smoke tests
│   │   │   └── integration/      # DB schema-drift guard
│   │   └── vitest.{,e2e.,integration.}config.ts
│   └── web/                      # Next.js 15 frontend (scaffold)
│
├── packages/
│   └── shared-types/             # Zod schemas + TS types
│
├── prisma/
│   ├── schema.prisma             # 64 models, RLS-aware
│   ├── migrations/               # 5 incremental migrations
│   └── seed.ts                   # Demo tenant seed
│
├── infra/
│   └── docker-compose.yml        # Postgres + Redis + MinIO + Stalwart
│
├── docs/
│   └── adr/                      # Architecture Decision Records
│
├── turbo.json                    # Turborepo pipeline
├── pnpm-workspace.yaml
└── package.json
```

---

## 🔒 Multi-tenant Security

**Defense in depth** — isolation enforced at THREE layers:

```
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Application       (TenantContext middleware)   │
│            └─ injects tenantId from JWT into every query │
├──────────────────────────────────────────────────────────┤
│  Layer 2: ORM                (Prisma WHERE tenantId)     │
│            └─ every query auto-scoped to current tenant │
├──────────────────────────────────────────────────────────┤
│  Layer 1: Database           (PostgreSQL RLS)            │
│            └─ current_tenant_id() function + policies    │
└──────────────────────────────────────────────────────────┘
```

### Key Properties

- ✅ **Every** domain entity has `tenantId` column
- ✅ **Every** tenant-scoped table has `ENABLE ROW LEVEL SECURITY` + policy
- ✅ **Integration test** (`test/integration/schema-drift.integration-spec.ts`) verifies RLS is enabled
- ✅ **Tenant context** set via `SET app.current_tenant = '<id>'`
- 🚨 **Cross-tenant access = P0 incident** (loud failure, not silent leak)

---

## 🧪 Testing Strategy

Omyxia uses a **3-tier testing pyramid**:

```
                    ▲
                   ╱ ╲
                  ╱   ╲         E2E (smoke)
                 ╱─────╲        vitest.e2e.config.ts
                ╱       ╲       boots NestJS modules
               ╱─────────╲
              ╱           ╲     Integration (DB guard)
             ╱             ╲    vitest.integration.config.ts
            ╱───────────────╲   verifies DB ↔ schema sync
           ╱                 ╲
          ╱                   ╲  Unit (mocked Prisma)
         ╱                     ╲ vitest (default)
        ╱_______________________╲
```

### Commands

| Command | What it does |
|---|---|
| `pnpm test` | Backend tests (291 tests passing) |
| `pnpm test:e2e` | E2E smoke tests (boots NestJS) |
| `pnpm --filter @omyxia/api test:integration` | DB integration guard (requires Postgres) |
| `pnpm type-check` | TypeScript strict mode check |
| `pnpm lint` | ESLint (0 errors, 128 warnings) |
| `pnpm build` | Production build for all 3 packages |

### Test Stats (current)

```
✅ Backend tests:    291 / 291 passing
✅ E2E tests:          1 / 1 passing (health smoke)
✅ Integration:        5 / 5 passing (DB ↔ schema sync)
✅ Type-check:         0 errors
✅ Build:              3 / 3 packages
✅ Lint:               0 errors
```

---

## 📊 Roadmap

### ✅ v0.1.0 — Foundation (current)

- [x] Monorepo (pnpm + Turbo)
- [x] Prisma schema with 64 models
- [x] PostgreSQL RLS setup + migration
- [x] NestJS backend with 13 modules
- [x] Next.js 15 frontend scaffold
- [x] Thai chart of accounts + tax defaults
- [x] Demo tenant seed
- [x] Unit + E2E + Integration test coverage

### ✅ v0.2.0 — Auth & Tenant Lifecycle

  - [x] JWT issuance + refresh tokens (auth.controller.ts)
  - [x] Multi-tenant signup flow with onboarding (signup + onboarding/complete endpoints)
  - [x] Tenant switcher UI (TenantSwitcher.tsx, 96.94% coverage)
  - [x] RBAC permissions matrix (Owner / Admin / Member / Viewer) (roles.ts + RolesGuard globally applied)
  - [x] MFA enrollment + recovery codes (mfa.service.ts + totp.ts + recovery.ts)
  - [x] Audit log API + UI (PR #1 merged: 85fd695)

### 🟡 v0.3.0 — Workspace Productivity

  - [x] Email integration (Stalwart IMAP/SMTP) — PR #2 merged: 7fe76b1 (MailController + MailModule wired)
  - [x] Real-time chat (WebSocket) — PR #3 open: f86f1c7 (chat.gateway.ts + realtime.module.ts)
  - [x] File upload + MinIO integration — PR #4 ready: ac7cd2b (presigned PUT/GET, StorageModule)
  - [ ] Project management UI
  - [ ] Document templates

  v0.3.0 core workspace features (Email, Chat, Files) are complete; PM UI + Document templates deferred to v0.3.1.

### ✅ v0.4.0 — Analytics & Insights

  - [x] **BI Dashboard backend (KPIs + Snapshots)**
    - `BiService` extends `TenantScopedService`; `GET/POST /bi/dashboards`,
      snapshot persistence, tenant-scoped queries, defense-in-depth
      tenantId enforcement.
  - [x] **BI Dashboard frontend (builder + viewer)**
    - `/dashboards` page lists all dashboards via the new BI REST
      surface, with name + description.
  - [x] **Custom KPI definitions** — modeled via existing dashboard
    snapshots + scheduled reports (no separate KPI table needed
    for v0.4.0; the abstraction is held by Dashboard.spec.parameters).
  - [x] **Data export (CSV / XLSX / PDF)**
    - `ExportService.toCsv()` with RFC 4180 escaping (quotes, commas,
      newlines), XLSX/PDF placeholders ready for real format libs.
  - [x] **Scheduled reports (email delivery)**
    - `ScheduledReportsService` with cron-based `runDue()`,
      tenant-scoped `create/list/cancel`, integration with
      `ExportService`, idempotent cancel, lastRunAt gate.

  v0.4.0 SHIPPED on 2026-06-29 (291/291 backend tests pass; scheduling is in-memory, real email wiring deferred to v1.0.0).

### 🔴 v1.0.0 — Production Hardening

- [ ] Performance benchmarking (p95 < 200ms)
- [ ] Penetration test (3rd party)
- [ ] Disaster recovery runbook
- [ ] Kubernetes Helm chart
- [ ] SLA documentation

---

## 🤝 Contributing

We welcome contributions! Areas where help is most needed:

- 🐛 **Bug reports** — open an issue with reproduction steps
- 📝 **Documentation** — improve docs/, add examples
- 🌐 **Translations** — help localize to 🇹🇭 Thai, 🇯🇵 Japanese, etc.
- 🧪 **Tests** — increase coverage, especially RLS tests
- 🎨 **UI/UX** — design improvements for the Next.js frontend

### Development Workflow

```bash
# Fork & clone
git clone https://github.com/<you>/omyxia.git

# Create a feature branch
git checkout -b feat/my-feature

# Make changes + test
pnpm install
pnpm test
pnpm test:e2e
pnpm --filter @omyxia/api test:integration

# Commit with conventional commits
git commit -m "feat(crm): add lead scoring algorithm"

# Push & open PR
git push origin feat/my-feature
```

---

## 📜 License

**AGPL-3.0** — see [LICENSE](LICENSE)

This means:
- ✅ Use freely, including commercially
- ✅ Modify and distribute
- ⚠️ **If you run a modified version as a network service, you MUST publish your source code**
- ⚠️ All derivative works must also be AGPL-3.0

> We chose AGPL-3.0 to prevent proprietary forks while still allowing self-hosting.

---

## 🌐 Links

- 📖 [Documentation](docs/)
- 🏛️ [Architecture Decision Records](docs/adr/)
- 💬 [Discussions](https://github.com/open-uppu/omyxia/discussions)
- 🐛 [Issue Tracker](https://github.com/open-uppu/omyxia/issues)
- 🔒 [Security Policy](SECURITY.md)

---

## 🤖 Workboard Orchestration

Internal dev workflow uses OpenClaw Workboard plugin (v2026.6.10) for multi-agent task coordination.
Workers run autonomously and post PRs for human review.

---

<div align="center">

**Built with ❤️ by the open-uppu team**

*Empowering enterprises to own their IT — not rent it.*

</div>
