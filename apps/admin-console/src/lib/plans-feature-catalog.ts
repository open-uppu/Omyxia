/**
 * Feature key catalog — the canonical list of `module.*`, `limit.*`,
 * `admin.*` keys an admin can toggle on a plan (P2.5).
 *
 * This is the FE mirror of the BE catalog owned by P3.1. The FE
 * imports it from:
 *   - The Plan editor (so the toggle grid is always one entry per key,
 *     even when a plan's `features[]` is empty).
 *   - The plan reordering validation (so a stale key can't survive).
 *
 * Conventions:
 *   - `kind: 'module'`  — boolean toggle, no limit.
 *   - `kind: 'limit'`   — toggle + numeric cap; `null` = unlimited
 *                         (only valid on ENTERPRISE / LEGACY_FULL_ACCESS).
 *   - `category: 'admin'` — governance features; mostly hidden from
 *                           customer-facing plans.
 *
 * `deletable: false` flags protects against accidentally wiping a
 * feature from the toggle grid (the editor still allows toggling).
 */

export interface FeatureCatalogEntry {
  /** Stable key — never changes for the lifetime of the catalog. */
  key: string;
  /** Human-readable label rendered in the toggle grid. */
  label: string;
  /** Category — used for visual grouping. */
  category: 'module' | 'limit' | 'admin';
  /** Whether the field also accepts a numeric cap. */
  kind: 'module' | 'limit';
  /** Whether the editor exposes a removable row. */
  deletable: boolean;
  /** Description — used for tooltips + helper text. */
  description: string;
}

export const FEATURE_CATALOG: readonly FeatureCatalogEntry[] = [
  // Modules
  { key: 'module.email', label: 'Email', category: 'module', kind: 'module', deletable: false, description: 'Multi-account mailbox + aliases.' },
  { key: 'module.chat', label: 'Chat', category: 'module', kind: 'module', deletable: false, description: 'Real-time team chat (WebSocket).' },
  { key: 'module.hr', label: 'HR', category: 'module', kind: 'module', deletable: false, description: 'Leave, attendance, payroll core.' },
  { key: 'module.crm', label: 'CRM', category: 'module', kind: 'module', deletable: false, description: 'Leads, pipeline, contacts.' },
  { key: 'module.erp', label: 'ERP', category: 'module', kind: 'module', deletable: false, description: 'General ledger, A/R, A/P.' },
  { key: 'module.wms', label: 'WMS', category: 'module', kind: 'module', deletable: false, description: 'Warehouse, bins, pick lists.' },
  { key: 'module.bi', label: 'BI', category: 'module', kind: 'module', deletable: false, description: 'Custom KPI dashboards + scheduled reports.' },
  { key: 'module.mas', label: 'MAS', category: 'module', kind: 'module', deletable: false, description: 'Manufacturing execution + scheduling.' },

  // Limits
  { key: 'limit.maxUsers', label: 'Max users', category: 'limit', kind: 'limit', deletable: false, description: 'Hard cap on user accounts. Null = unlimited.' },
  { key: 'limit.maxStorageGB', label: 'Max storage (GB)', category: 'limit', kind: 'limit', deletable: false, description: 'Storage quota across MinIO buckets. Null = unlimited.' },

  // Admin / governance
  { key: 'admin.audit', label: 'Audit log', category: 'admin', kind: 'module', deletable: false, description: 'Read access to the super_admin audit log.' },
  { key: 'admin.sso', label: 'SSO', category: 'admin', kind: 'module', deletable: false, description: 'SAML / OIDC single sign-on.' },
] as const;

export function findCatalogEntry(
  key: string
): FeatureCatalogEntry | undefined {
  return FEATURE_CATALOG.find((entry) => entry.key === key);
}

export function catalogKeyLookup(): Map<string, FeatureCatalogEntry> {
  const map = new Map<string, FeatureCatalogEntry>();
  for (const entry of FEATURE_CATALOG) map.set(entry.key, entry);
  return map;
}

/**
 * Sort the catalog by `category` (modules first, then limits, then
 * admin) and within each category by label. The editor renders the
 * toggle grid in this order until the user drags a feature to a
 * different position.
 */
export function catalogInDisplayOrder(): readonly FeatureCatalogEntry[] {
  const order: Record<FeatureCatalogEntry['category'], number> = {
    module: 0,
    limit: 1,
    admin: 2,
  };
  return [...FEATURE_CATALOG].sort((a, b) => {
    if (a.category !== b.category) return order[a.category] - order[b.category];
    return a.label.localeCompare(b.label);
  });
}
