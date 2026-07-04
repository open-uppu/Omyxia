# 🚀 omyxia v2.0.0 — Admin Console & Tier-based Access

**Kickoff:** 2026-07-04 19:05 GMT+7
**Scope:** 22 cards across 5 phases
**Strategy:** Tier 1 (Admin Console) first → Tier 2 (Feature Gating) → Billing → Migration
**Pricing:** Hybrid (Plan + Add-on modules)
**Migration:** v1.0.0 tenants → "Legacy Full Access" plan (no user disruption)

## 📊 Dependency Graph

```
Phase 1 (Backend — 8 cards)
  P1.1 Schema ──┬── P1.2 Seed ──┐
                ├── P1.3 Auth ──┤
                └── (foundations)
                       │
                P1.4 List API ──┬── P1.5 Create ──┐
                               ├── P1.6 Suspend ─┤
                               └── P1.7 Impersonate
                                              │
                                       P1.8 Tests (depends on P1.5/6/7)
                                              │
Phase 2 (Frontend — 5 cards)                 │
  P2.1 Shell ← P1.4                          │
    ├── P2.2 Dashboard                        │
    ├── P2.3 Tenant list ← P2.1, P1.4         │
    │    └── P2.4 Tenant detail ← P2.3, P1.7  │
    └── P2.5 Plan mgmt ← P2.3, P1.2           │
                                              │
Phase 3 (Feature Gating — 5 cards)            │
  P3.1 @RequiresFeature ← P1.1                │
    ├── P3.2 Frontend hide ← P3.1, P2.5       │
    ├── P3.3 Cache invalidation ← P1.2, P3.1  │
    ├── P3.4 Upgrade modal ← P3.2             │
    └── P3.5 Tests ← P3.3, P3.4               │
                                              │
Phase 4 (Billing — 2 cards)                   │
  P4.1 Stripe ← P1.2, P1.5 ─── P4.2 Metering │
                                              │
Phase 5 (Migration — 2 cards)                 │
  P5.1 Migration ← P1.2, P1.5 ──┐             │
  P5.2 WORM + SOC2 ← P1.7, P5.1 ─┘            │
```

## 🃏 All Cards

See: `openclaw workboard list --status todo --json | jq '.cards[] | select(.title | contains("omyxia v2.0.0"))'`

| ID | Phase | Title | Agent | Priority |
|---|---|---|---|---|
| 0397196e | P1.1 | Schema: plans, plan_features, add_ons, tenant_entitlements, impersonation_sessions | open-uppu-be | high |
| cf713c89 | P1.2 | Seed default plans (Free/Pro/Enterprise) + feature matrix + add-on catalog | open-uppu-be | high |
| 9e1edc98 | P1.3 | Auth middleware: super_admin role bypass RLS (audit-logged) | open-uppu-be | high |
| 30b59dce | P1.4 | API: GET /api/admin/tenants (list, search, filter) | open-uppu-be | high |
| 5c94a7b5 | P1.5 | API: POST /api/admin/tenants (create + onboarding wizard) | open-uppu-be | high |
| 9d4f322b | P1.6 | API: POST /api/admin/tenants/:id/suspend (kill switch) | open-uppu-be | high |
| 848656db | P1.7 | API: POST /api/admin/impersonate/:tenantId (audit + TTL) | open-uppu-be | high |
| 76ea2b29 | P1.8 | Tests: admin API 90% coverage (unit + integration) | jito-test | high |
| 2a35ae45 | P2.1 | Frontend shell: admin.omyxia.app (auth gate + layout + sidebar) | open-uppu-fe | high |
| f9b59300 | P2.2 | Frontend dashboard: tenant count, MRR, storage, API volume | open-uppu-fe | high |
| 6c2ffb61 | P2.3 | Frontend tenant list: search, filter, pagination, actions | open-uppu-fe | high |
| 8027c109 | P2.4 | Frontend tenant detail: users, plan, usage, impersonate button | open-uppu-fe | high |
| 72ce4aa9 | P2.5 | Frontend plan management: create/edit plans + add-ons + price | open-uppu-fe | high |
| bf3884d9 | P3.1 | Backend: @RequiresFeature('crm') decorator + 403 response | open-uppu-be | high |
| 34f4b77d | P3.2 | Frontend: hide menu + route guard based on entitlements | open-uppu-fe | high |
| f95e5b87 | P3.3 | Backend: plan change → invalidate entitlement cache (Redis pub/sub) | open-uppu-be | high |
| c983572f | P3.4 | Frontend: Upgrade plan modal when access denied | open-uppu-fe | high |
| 4b830ab0 | P3.5 | Tests: feature gating 100% coverage (positive + negative) | jito-test | high |
| 159c1a1f | P4.1 | Stripe integration: subscription + add-on proration | open-uppu-be | high |
| 443e789e | P4.2 | Usage metering: storage + API calls → invoice line items | open-uppu-be | high |
| ef280160 | P5.1 | Migration: v1.0.0 tenants → 'Legacy Full Access' plan | open-uppu-be | high |
| 6228e608 | P5.2 | Audit: WORM storage for super_admin actions + SOC2 docs | open-uppu-be | high |

## 🎯 Pricing Model (Hybrid)

**Plans:**
- **Free** — 1 user, 1GB, email only
- **Pro ($99/mo)** — 25 users, 100GB, email + chat + hr
- **Enterprise ($499/mo)** — unlimited, all modules

**Add-ons:**
- CRM ($50/mo) · ERP ($80/mo) · WMS ($60/mo) · BI ($40/mo) · MAS ($45/mo)

## 🛡️ Migration Plan

- All v1.0.0 tenants → "Legacy Full Access" plan
- Expires: 2027-12-31
- Email notification: "choose your plan before expires"
- No user disruption during migration

## ⚙️ Execution

- **Cards:** 22 created in Workboard
- **Cron:** Tick.sh runs every 2 min (cascade + dispatch + auto-complete)
- **Sync:** Worker worktree → main repo (every 2 min)
- **ETA:** ~7-9 days sequential (1 worker per agent_id concurrency)

## 📊 Status Tracking

Check progress: `openclaw workboard list --status running`
Done count: `openclaw workboard list --status done --json | jq '[.cards[] | select(.title | contains("omyxia v2.0.0"))] | length'`