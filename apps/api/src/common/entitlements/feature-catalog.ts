/**
 * Canonical feature-key catalog (omyxia v2.0.0).
 *
 * Mirrors the catalog declared on the FE in
 * `packages/shared-types/src/admin-entitlements.ts`.  When P3.1 lands the
 * BE becomes the source of truth — the FE catalog is auto-validated by
 * zod against unknown keys, but a FE-only key that has no entry here
 * will simply resolve to `false` (fail-closed).
 *
 * Conventions (kept in lockstep with `admin-entitlements.ts`):
 *
 *   module.<name>      — boolean module flag (`module.crm`, `module.hr`).
 *   limit.<camelCase>  — numeric quota (`limit.maxEmployees`,
 *                          `limit.maxStorageGB`).
 *   admin.<name>       — admin-console-only flag (`admin.tenants`,
 *                          `admin.audit`, `admin.plans`).
 *
 * Why a central enum-style union rather than free-form `string`?
 *   - Lets `@RequiresFeature('module.crm')` be type-checked at the
 *     controller call-site — a typo'd `module.cm` raises a TS error
 *     instead of silently failing-closed at runtime.
 *   - Lets the upgrade-URL builder offer the correct "best-fit plan"
 *     upgrade copy without a registry lookup.
 *
 * The catalog is split into three separate unions because feature keys
 * are deliberately namespaced: `module.*` for end-user modules,
 * `limit.*` for numeric caps, `admin.*` for super-admin-only surfaces.
 * Crossing them in `@RequiresFeature()` would be a typo your linter
 * will catch.
 */

// ----------------------------------------------------------------------------
// Module flags — boolean `is this module enabled?`
// ----------------------------------------------------------------------------
export const MODULE_FEATURES = [
  'module.crm',          // sales pipelines + leads + activities
  'module.hr',           // employees + leave + attendance + payroll
  'module.erp',          // COA + journals + AP/AR + tax + fiscal
  'module.bi',           // KPI dashboards + scheduled reports
  'module.reports',      // ad-hoc report runner
  'module.storage',      // file uploads (S3 / MinIO)
  'module.email',        // inbound + outbound email
  'module.chat',         // realtime chat
  'module.documents',    // document templates + e-sign instances
  'module.projects',     // projects + tasks + Gantt-lite
  'module.marketing',    // campaigns + customer-profile events
  'module.backup',       // backup-records + restore
  'module.endpoint',     // endpoint security (device + threats)
  'module.itsm',         // tickets + SLA tracking
  'module.srm',          // supplier + score + assessment
  'module.fms',          // vehicle trip + cost
  'module.frm',          // fraud alerts
  'module.mas',          // marketing automation service
  'module.wms',          // warehouse + stock movements
] as const;

export type ModuleFeature = (typeof MODULE_FEATURES)[number];

// ----------------------------------------------------------------------------
// Limit features — numeric caps
// ----------------------------------------------------------------------------
export const LIMIT_FEATURES = [
  'limit.maxUsers',       // seats in this tenant
  'limit.maxEmployees',   // HR module employees count
  'limit.maxLeads',       // CRM leads total active
  'limit.maxStorageGB',   // S3 / MinIO total bytes
  'limit.maxProjects',    // projects per tenant
  'limit.maxTickets',     // ITSM tickets open at once
  'limit.maxBackupGB',    // restore history retained
] as const;

export type LimitFeature = (typeof LIMIT_FEATURES)[number];

// ----------------------------------------------------------------------------
// Admin flags — super-admin-only surfaces
// ----------------------------------------------------------------------------
export const ADMIN_FEATURES = [
  'admin.tenants',        // tenants list + suspend API
  'admin.audit',          // audit log viewer
  'admin.plans',          // plan / feature matrix editor
  'admin.addons',         // add-on catalog editor
  'admin.entitlements',   // override a tenant's plan from admin console
  'admin.impersonation',  // open impersonation sessions
] as const;

export type AdminFeature = (typeof ADMIN_FEATURES)[number];

// ----------------------------------------------------------------------------
// Convenience unions
// ----------------------------------------------------------------------------
export const ALL_FEATURES = [
  ...MODULE_FEATURES,
  ...LIMIT_FEATURES,
  ...ADMIN_FEATURES,
] as const;
export type FeatureKey = (typeof ALL_FEATURES)[number];

/**
 * Detect whether a key belongs to a particular namespace.
 * Used by the guard to know which "kind" of check to do.
 */
export function classifyFeature(
  key: string,
): 'module' | 'limit' | 'admin' | 'unknown' {
  if ((MODULE_FEATURES as readonly string[]).includes(key)) return 'module';
  if ((LIMIT_FEATURES as readonly string[]).includes(key)) return 'limit';
  if ((ADMIN_FEATURES as readonly string[]).includes(key)) return 'admin';
  return 'unknown';
}

/**
 * The plan slug that first unlocks a given feature.
 *
 *   FREE          — base plan, no add-ons
 *   PRO           — paid plan with most modules
 *   ENTERPRISE    — everything unlimited
 *   LEGACY_FULL_ACCESS — grandfathered legacy plan, no upgrade needed
 *
 * `null` means no plan upgrades the feature (e.g. an experimental flag
 * that's only available via direct contact).
 */
export const FEATURE_RECOMMENDED_PLAN: Record<FeatureKey, 'PRO' | 'ENTERPRISE' | null> = {
  'module.crm': 'PRO',
  'module.hr': 'PRO',
  'module.erp': 'PRO',
  'module.bi': 'ENTERPRISE',
  'module.reports': 'PRO',
  'module.storage': 'PRO',
  'module.email': 'PRO',
  'module.chat': 'PRO',
  'module.documents': 'PRO',
  'module.projects': 'PRO',
  'module.marketing': 'PRO',
  'module.backup': 'PRO',
  'module.endpoint': 'ENTERPRISE',
  'module.itsm': 'PRO',
  'module.srm': 'ENTERPRISE',
  'module.fms': 'ENTERPRISE',
  'module.frm': 'ENTERPRISE',
  'module.mas': 'ENTERPRISE',
  'module.wms': 'ENTERPRISE',

  'limit.maxUsers': 'PRO',
  'limit.maxEmployees': 'PRO',
  'limit.maxLeads': 'PRO',
  'limit.maxStorageGB': 'PRO',
  'limit.maxProjects': 'PRO',
  'limit.maxTickets': 'PRO',
  'limit.maxBackupGB': 'ENTERPRISE',

  'admin.tenants': 'PRO',
  'admin.audit': 'PRO',
  'admin.plans': 'PRO',
  'admin.addons': 'PRO',
  'admin.entitlements': 'PRO',
  'admin.impersonation': 'ENTERPRISE',
};

/** Human-readable label for the upgrade page. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  'module.crm': 'CRM & Sales Pipeline',
  'module.hr': 'HR & Payroll',
  'module.erp': 'ERP & Accounting',
  'module.bi': 'Business Intelligence',
  'module.reports': 'Report Runner',
  'module.storage': 'Cloud Storage',
  'module.email': 'Shared Email',
  'module.chat': 'Team Chat',
  'module.documents': 'Document Templates',
  'module.projects': 'Projects & Tasks',
  'module.marketing': 'Marketing Campaigns',
  'module.backup': 'Backups & Restore',
  'module.endpoint': 'Endpoint Security',
  'module.itsm': 'ITSM / Helpdesk',
  'module.srm': 'Supplier Relationship',
  'module.fms': 'Fleet Management',
  'module.frm': 'Fraud Alerts',
  'module.mas': 'Marketing Automation',
  'module.wms': 'Warehouse Management',

  'limit.maxUsers': 'Additional User Seats',
  'limit.maxEmployees': 'HR Employee Quota',
  'limit.maxLeads': 'CRM Lead Quota',
  'limit.maxStorageGB': 'Storage Quota',
  'limit.maxProjects': 'Project Quota',
  'limit.maxTickets': 'Ticket Quota',
  'limit.maxBackupGB': 'Backup Retention',

  'admin.tenants': 'Tenant Administration',
  'admin.audit': 'Audit Log Access',
  'admin.plans': 'Plan & Feature Editor',
  'admin.addons': 'Add-on Catalog Editor',
  'admin.entitlements': 'Per-tenant Entitlement Override',
  'admin.impersonation': 'Super-admin Impersonation',
};
