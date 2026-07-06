# Data Retention Policy (v2.0.0)

> **SOC2 scope.** This document is the authoritative answer to SOC2
> CC1.5 ("the entity retains and monitors customer data in
> accordance with contractual, legal, and regulatory requirements")
> and C1 (privacy-related). It covers the v2.0.0 Omyxia deployment
> including the admin console, the workspace API, the Stripe billing
> module, and the P5.2 WORM audit log.
>
> **One-paragraph summary.** **Production data is retained for 7
> years** to satisfy SOC2 + GDPR + PIPEDA. The WORM audit log is
> retained **indefinitely within the 7-year window** and aged out
> by partitioning (P5.4). Soft-deletes are *physical* deletes after
> 30 days unless the customer requests retention otherwise.
> Stripe customer records are mirrored one-way from Stripe's API; we
> never write back to Stripe on deletion (Stripe is the system of
> record for billing). Data exports on customer request are
> delivered in the customer's `preferred format` (CSV/JSON), within
> 30 days, with full audit-log trail.
>
> **How to read this doc.** Every table (or class of records) is
> listed with: (1) the canonical retention period, (2) the legal
> / contractual basis, (3) the deletion mechanism, and (4) the data
> export view. Operations append-only via the WORM chain hash ensure
> any change to this policy is itself logged.

## Quick reference

| Class | Retention | Basis | Deletion |
|---|---|---|---|
| `AuditLog` rows | 7 years | SOC2 CC1.5 | Partition drop (P5.4) |
| WORM S3 snapshots | 7 years (Object Lock) | SOC2 CC6.1 | COMPLIANCE lock refuses delete |
| Stripe customer mirror | Mirrored; we don't authoritatively delete | P4.1; Stripe is billing SOR | Delete via Stripe API, our row falls to `expired` via webhook |
| PII (CRM leads, customers, contacts) | Active + soft-delete 30 d, then physical | GDPR Art. 5(1)(e) | Background job + customer export |
| Financial (JournalEntry, Payroll) | 7 years | PIPEDA + Thai tax law | Cryptographic archive only |
| Email (in/out) | 7 years | Legal hold for litigation | Off-band S3 with rotation |
| MFA recovery codes | One-time-use; consumed on first verify | n/a | Atomic delete on use |
| Refresh tokens | 30 days sliding; revoked on logout | n/a | TTL index |
| Uploaded files (Files module) | Tenant lifecycle + 30 d post-delete | Customer-driven | Background job |
| Chat messages | Tenant lifecycle + 30 d post-delete | Customer-driven | Background job |
| Project / Document tasks | Tenant lifecycle + 30 d post-delete | Customer-driven | Background job |
| Marketing events | Tenant lifecycle + 90 d | Customer-driven | Background job |
| BI dashboard aggregates | 90 days hot, 1 year cold, then anonymized | Customer-driven | Tiered storage |
| Backups (DB + storage) | 30 days rolling | DR | Hourly cron, 24h × 30d |
| AWS CloudTrail / K8s audit | 1 year | SOC2 CC7.2 | Native retention |

Where multiple bases overlap (e.g. financial records), the **most
conservative** retention wins — never the shortest.

## Legal & contractual bases

| Regulation | Applies to | Retention |
|---|---|---|
| **SOC2** (Type II) | All logs touching protected data | 1 year online + 7 years archive |
| **GDPR** (Art. 5(1)(e)) | EU personal data | "No longer than necessary"; typical max = 7 y for accounting / 6 y for HR / 30 d for analytics |
| **PIPEDA** (Canada) | Personal information used for decisions | "As long as needed"; typical = 7 y |
| **Thai Revenue Code** §19 | Thai accounting records | 5 years from filing; we extend to 7 to align with SOC2 |
| **SOX** (if customer is publicly listed) | Financial reporting trail | 7 years |
| **HIPAA** (only when customer is a covered entity) | PHI | 6 years from creation; we do not store PHI by default |
| **CCPA / CPRA** | California consumer data | "Reasonable" retention; we cap at 7 y to match SOC2 |
| **Customer contract** | Per-customer OMA (Master Service Agreement) | Whatever the OMA specifies, capped at 7 y |

The 7-year ceiling is a deliberate Omyxia policy: it dominates every
common regulation we encounter without forcing us to pick-and-choose
per-deployment.

## Per-table retention table (canonical)

Tables not listed here inherit "tenant lifecycle + 30 d post-delete".

| Table | Retention | Hard-delete mechanism | Notes |
|---|---|---|---|
| `Tenant` | Until customer requests account deletion; max 7 y | Background `purge-tenant` job | Follows GDPR / PIPEDA |
| `User` | Same as `Tenant` | Cascade | Soft-delete blocked; password hashes never exported |
| `UserTenant` (membership) | Same as `Tenant` | Cascade | |
| `RefreshToken` | 30 days sliding; revoked on logout | TTL index | Used for JWT refresh |
| `MfaFactor` | Tenant lifecycle | Cascade | Recovery codes one-time-use |
| `UserSession` | Tenant lifecycle | Cascade | |
| `AuditLog` | **7 y** (SOC2) | Partition drop (P5.4) | WORM chain must remain verifiable until delete |
| `Plan`, `PlanFeature`, `AddOn` | Tenant lifecycle (catalog) | n/a (system-managed) | Seeded by Prisma |
| `TenantEntitlement`, `TenantEntitlementAddOn` | Tenant lifecycle | Cascade | |
| `StripeCustomer`, `StripeSubscription`, `StripeSubscriptionItem`, `StripeWebhookEvent` | Mirrored from Stripe; expired when Stripe says so | Cascade on Stripe webhook `customer.subscription.deleted` | Stripe is billing SOR |
| `CrmLead`, `CrmActivity`, `CrmPipeline` | Tenant lifecycle + 30 d soft-delete grace | Soft-delete via `deletedAt`; physical delete via background job | PII |
| `Customer`, `CustomerEvent`, `CustomerProfile`, `MarketingCampaign` | Same as CRM | Same | PII |
| `EmailMessage`, `EmailTemplate` | 7 y | Same | Legal hold may extend |
| `ChatChannel`, `ChatChannelMember`, `ChatMessage` | Tenant lifecycle + 30 d | Cascade / background job | |
| `FileItem`, `FileFolder` | Tenant lifecycle + 30 d; storage object same | Background job + S3 lifecycle policy on prefix `tenants/*` | WORM `audit-log/*` prefix is exempt (Object Lock) |
| `DocumentInstance`, `DocumentTemplate` | Tenant lifecycle + 30 d | Cascade | |
| `Project`, `ProjectTask` | Tenant lifecycle + 30 d | Cascade | |
| `JournalEntry`, `JournalLine`, `ArInvoice`, `ApBill`, `TaxTransaction` | **7 y** | Archived to cold storage only; do NOT delete from primary | Financial records |
| `PayrollPeriod`, `PayrollLine`, `AttendanceRecord`, `LeaveRequest`, `LeaveQuota` | **7 y** | Same | Payroll |
| `Employee`, `Position`, `Department` | Tenant lifecycle (HR) | Soft-delete only (privacy) | |
| `MfaSecret` (expos. via MfaFactor) | Tenant lifecycle | Cascade | bcrypt-hashed |
| `Backup` (s3 keys) | 30 days rolling | S3 lifecycle policy | DR backups only |
| `CreditAssessment`, `CashFlowForecast`, `FraudAlert` | Tenant lifecycle + 90 d hot, then `archive` | Background job | |
| `BiDashboard`, BiAggregates | 90 d hot, 1 y cold, then anonymized | Tiered storage job | |
| K8s/CloudTrail logs | 1 y | Native retention | SOC2 CC7.2 |

## Deletion workflows

### Tenant deletion

Triggered by `POST /admin/tenants/:id/purge` (super-admin only, dual-key
+ reason code ≥ 32 chars). Workflow:

1. Soft-delete all tenant rows (`deletedAt = now()`) by background job.
2. Wait 30 days (recoverable window). Customer can re-open within
   this window via `POST /admin/tenants/:id/undelete`.
3. After 30 days, hard-delete via the `purge-tenant` job:
   - Postgres: drop from primary tables.
   - S3 prefix `tenants/<tenantId>/` purged via lifecycle policy on
     `tenants/*/...`.
   - Redis: invalidate all `entitlements:v1:<tenantId>` keys + pub/sub
     notification to all replicas.
4. WORM `AuditLog` rows for the tenant keep `tenantId` but the
   column is left untouched (no UPDATE allowed). The audit reader
   surfaces "tenant no longer exists — see WORM snapshot YYYY-MM-DD"
   so customers know it was a real deletion.

### Single-record PII deletion (GDPR Art. 17 right-to-erasure)

1. Customer submits via `POST /admin/privacy/erase-record` (super-admin
   workflow) with the row id + verified identity.
2. Background job selects the row + all dependent rows (cascade).
3. PII columns are wiped (set to `null` or literal `***`). The row
   itself keeps `id` + `updatedAt` to preserve referential integrity
   + the WORM audit chain.
4. A new `AuditLog` row is appended with `action: 'ERASE_PII'` to
   keep the deletion itself part of the audit trail.

### Financial records (7 y archive)

The `JournalEntry`, `PayrollLine`, `TaxTransaction` etc. are NOT
deleted by the tenant lifecycle. Instead, they're partitioned
(P5.4) and dropped only after 7 years from `fiscalPeriod.closeAt`
or equivalent cutoff. The drop is itself logged (pre + post counts)
and signed by the WORM audit chain so an auditor can prove "we did
delete on 2030-01-01 at 00:00 UTC, here are the manifest objects
that were dropped".

## Data exports

Customer data export (GDPR Art. 20 right-to-portability) is delivered
in two formats, both written to a customer-owned S3 prefix:

```
s3://<customer-prefix>/export-<request-id>/
  audit-logs.jsonl.gz     (signed, see P5.2)
  workspace.zip           (CSVs of every workspace entity)
```

The export endpoint is `POST /admin/tenants/:id/export` (super-admin
+ customer-cosignature). The export itself is logged to the WORM
audit log so customers can confirm "yes, our data was exported by
operator X at YYYY-MM-DD HH:MM UTC". The signature on the exported
`.jsonl.gz` file uses the same `AUDIT_HMAC_SECRET` so the customer
can verify that the file is the same we signed.

Self-host customers get the same workflow, scoped to their own bucket.

## GDPR/PIPEDA breach disclosure (Sev 1)

| Step | Time-to-action |
|---|---|
| Open Sev 1 incident | 0 h |
| CISO + Legal alerted | < 1 h |
| Internal containment + breach confirmation | < 24 h |
| Customer + regulator notification (GDPR Art. 33) | < 72 h |
| Customer notification (GDPR Art. 34 if data subject impacted) | < 72 h |

The WORM audit chain is the primary evidence for these notifications;
a regulatory disclosure includes (1) a sanitized chain-hash of the
relevant audit rows and (2) the S3 Object-Locked snapshot from the
day before the breach.

## Backup retention

The DR runbook (`docs/runbooks/DISASTER_RECOVERY.md`) maintains:

| Asset | Frequency | Online retention | Archive retention |
|---|---|---|---|
| Postgres logical dump | Hourly | 7 days | 30 days (Glacier-class) |
| Postgres base backup | Daily | 30 days | 1 year (Glacier) |
| S3 audit-log snapshot | Daily | 7 years (Object Lock) | n/a |
| MinIO tenant file snapshots | Daily | 7 days | 30 days |
| Redis (no backup) | n/a | n/a | n/a |

## Audit retention enforcement

The `AuditLog` table is partitioned by year (P5.4 added later) so the
7-year ceiling is enforced by a year drop:

```sql
-- Year-drop job (P5.4; example for the 2030-01-01 drop of 2023 rows):
BEGIN;
  -- WORM trigger is intentionally left in place; we use partition-level
  -- DETACH + DROP which the trigger can't catch (it's row-level only).
  ALTER TABLE "AuditLog" DETACH PARTITION "AuditLog_2023";
  DROP TABLE "AuditLog_2023";
COMMIT;
```

The drop itself is logged in a separate `audit_purge_log` table
**outside** the AuditLog WORM scope (this table is normal — it's
meta-meta-evidence for the auditor) and the S3 Object-Lock snapshot
for the purged year is preserved for an additional 90 days so a
late-stage regulator audit can replay.

## Self-host retention knobs

Self-hosted customers can configure retention via `.env`:

```
AUDIT_LOG_RETENTION_DAYS=2555  # default 7y
FINANCIAL_RETENTION_DAYS=2555  # default 7y
PII_SOFT_DELETE_GRACE_DAYS=30  # default 30 d
EMAIL_RETENTION_DAYS=2555     # default 7y
BACKUP_RETENTION_DAYS=30       # default 30 d
```

The default values match the canonical 7-year ceiling. Customers who
need shorter retention (e.g., a regulated environment that caps at
3 years) get a `Shorter: true` flag in their contract; we do not
support retention longer than 7 years (the Object Lock retention cap
is 100 years but our S3 setup is 7).

## Versioning & change control

| Date | Author | Change |
|---|---|---|
| 2026-07-06 | open-uppu-be | Initial v2.0.0 policy (P5.2) |
| (future)  | (next retention review) | Annual review by CISO + Legal + DPO. Each change is logged to the `audit_purge_log` table as `DOC_POLICY_UPDATE`. |
