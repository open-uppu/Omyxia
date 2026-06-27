# open-uppu — Multi-tenant Enterprise IT Master Blueprint (SaaS)

**OSS-only. Self-hosted. Multi-tenant (PostgreSQL RLS). AGPL-3.0.**

> Replaces ERP + HRM + CRM + Email + Chat + File Share + ... (14 systems) with one open platform.

## 🏗️ Architecture (5 layers)

```
Layer 7: BI Dashboard
Layer 6: Workspace (Email + Chat + File + Intranet)
Layer 5: Core Pillars (CRM · ERP · HRM) + Specialized (MAS/CDP, PMS/DMS, WMS/SRM, FMS, ITSM, FRM)
Layer 4: Cross-cutting (FMS + CMP/PDPA)
Layer 1: Infrastructure & Security (IAM + Endpoint + Backup + Multi-tenant RLS)
```

## 🛠️ Tech Stack (OSS-only)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 + TypeScript + shadcn/ui + next-intl |
| Backend | NestJS 10 + TypeScript |
| DB | PostgreSQL 16 + Prisma 5 + RLS |
| Auth | Auth.js v5 + CASL (RBAC) |
| Queue | BullMQ + Redis |
| Storage | MinIO |
| Email | Stalwart Mail Server |
| Observability | Grafana OSS + Loki + Prometheus + Tempo |
| Tests | Vitest + Playwright + pglite |

## 🚀 Quick Start

```bash
# 1. Install
pnpm install

# 2. Start infrastructure
sg docker -c 'docker compose -f infra/docker-compose.yml up -d postgres redis minio stalwart'

# 3. Run migrations
pnpm db:migrate

# 4. Seed demo data
pnpm db:seed

# 5. Start dev servers
pnpm dev
```

## 🔒 Multi-tenant Security

Every domain entity has `tenant_id` + RLS policy at PostgreSQL layer.

- Defense in depth: DB-level RLS + app-level middleware
- 8 mandatory isolation tests per module
- Cross-tenant access = P0 incident

## 📦 Repository Layout

```
open-uppu/
├── apps/
│   ├── api/          # NestJS 10 backend
│   └── web/          # Next.js 15 frontend
├── packages/
│   ├── shared-types/ # Zod + TS types
│   ├── ui/           # shadcn wrappers
│   └── i18n/         # TH + EN messages
├── prisma/           # Schema + migrations + seed
├── infra/            # Docker compose + configs
└── docs/             # Architecture + ADRs
```

## 📜 License

AGPL-3.0 — see [LICENSE](LICENSE)
