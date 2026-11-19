import type { MicroserviceId, ServicePlanTier } from '@omyxia/shared-types';

export interface MicroserviceMeta {
  id: MicroserviceId;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  category: 'core' | 'operations' | 'finance' | 'intelligence' | 'governance';
  route: string;
  iconName: 'Building2' | 'Users' | 'Briefcase' | 'Layers' | 'Boxes' | 'BarChart3' | 'ShieldCheck' | 'LayoutGrid';
  minPlanTier: ServicePlanTier;
  badge?: 'Included' | 'Starter' | 'Pro' | 'Enterprise' | 'Add-on';
  highlightFeatures: string[];
  capabilities: {
    title: string;
    description: string;
  }[];
}

export const MICROSERVICES_REGISTRY: Record<MicroserviceId, MicroserviceMeta> = {
  core: {
    id: 'core',
    name: 'Omyxia Core & IAM',
    shortName: 'Core',
    tagline: 'Multi-tenant Identity, Roles, and Workspace Management',
    description: 'Foundational authentication, user directory, tenant switching, and system security controls.',
    category: 'core',
    route: '/dashboard',
    iconName: 'LayoutGrid',
    minPlanTier: 'FREE',
    badge: 'Included',
    highlightFeatures: [
      'Multi-tenant workspace isolation',
      'Role-based access control (RBAC)',
      'Single Sign-On (SSO) & MFA',
      'Session & device management',
    ],
    capabilities: [
      { title: 'Unified Identity', description: 'Centralized tenant authentication and user directory.' },
      { title: 'Permission Matrix', description: 'Granular role delegation across workspaces.' },
    ],
  },

  workspace: {
    id: 'workspace',
    name: 'Omyxia Workspace Hub',
    shortName: 'Workspace',
    tagline: 'Team Collaboration, Documents & Secure File Storage',
    description: 'Integrated team chat, project files, document templates, and real-time workspace collaboration.',
    category: 'core',
    route: '/projects',
    iconName: 'Layers',
    minPlanTier: 'FREE',
    badge: 'Included',
    highlightFeatures: [
      'Real-time team chat & direct messaging',
      'MinIO / S3 document & asset vault',
      'Dynamic document templates renderer',
      'Project workspaces & task tracking',
    ],
    capabilities: [
      { title: 'Project Rooms', description: 'Organize files, tasks, and communications in one space.' },
      { title: 'Document Vault', description: 'Secure S3-backed asset storage with versioning.' },
    ],
  },

  hrm: {
    id: 'hrm',
    name: 'Omyxia HRM & People',
    shortName: 'HRM',
    tagline: 'Employee Directory, Leaves, and Automated Thai Payroll',
    description: 'Complete human resource management suite with attendance tracking, leave workflows, and compliant payroll calculations.',
    category: 'operations',
    route: '/hrm',
    iconName: 'Users',
    minPlanTier: 'STARTER',
    badge: 'Starter',
    highlightFeatures: [
      'Automated Thai Payroll & Social Security (SSO/PND1)',
      'Digital leave approvals with multi-level workflows',
      'Clock-in/out attendance with GPS verification',
      'Employee directory & personal records',
    ],
    capabilities: [
      { title: 'Payroll Automation', description: 'One-click payroll run with auto tax withholding deductions.' },
      { title: 'Leave & Attendance', description: 'Customizable leave quotas and time clocking.' },
    ],
  },

  crm: {
    id: 'crm',
    name: 'Omyxia CRM & Sales',
    shortName: 'CRM',
    tagline: 'Customer Relationship, Lead Scoring & Sales Pipelines',
    description: 'Drive revenue with visual kanban deal boards, automated lead routing, and customer lifecycle insights.',
    category: 'operations',
    route: '/crm',
    iconName: 'Briefcase',
    minPlanTier: 'STARTER',
    badge: 'Starter',
    highlightFeatures: [
      'Visual deal pipelines with drag-and-drop Kanban',
      'Lead scoring & automated distribution',
      'Activity logging (Calls, Meetings, Emails)',
      'Win/Loss analytics & revenue forecasting',
    ],
    capabilities: [
      { title: 'Pipeline Visibility', description: 'Track high-value prospects from prospect to signed contract.' },
      { title: 'Customer 360', description: 'Complete touchpoint history in a unified customer profile.' },
    ],
  },

  erp: {
    id: 'erp',
    name: 'Omyxia ERP & Finance',
    shortName: 'ERP',
    tagline: 'Double-Entry General Ledger, Invoicing & Thai Tax Compliance',
    description: 'Enterprise financial management featuring balanced journals, Chart of Accounts, e-tax invoices, and WHT/VAT reporting.',
    category: 'finance',
    route: '/erp',
    iconName: 'Building2',
    minPlanTier: 'PRO',
    badge: 'Pro',
    highlightFeatures: [
      'Double-entry General Ledger (GL) & Journal Entries',
      'Thai Revenue Department WHT (PND 3, 53) & VAT (PP 30) reports',
      'Automated AR Invoicing & Billing Schedules',
      'Configurable Chart of Accounts (COA) with sub-ledgers',
    ],
    capabilities: [
      { title: 'Balanced Ledgers', description: 'Strict debit/credit validation and automated trial balances.' },
      { title: 'Tax Compliance', description: 'Instant generation of Thai revenue tax forms and e-filing files.' },
    ],
  },

  wms: {
    id: 'wms',
    name: 'Omyxia WMS & Logistics',
    shortName: 'WMS',
    tagline: 'Multi-Warehouse Inventory, Stock Movements & Barcode Tracking',
    description: 'High-throughput warehouse operations with real-time stock levels, SKU tracking, bin locations, and automated reorder triggers.',
    category: 'operations',
    route: '/wms',
    iconName: 'Boxes',
    minPlanTier: 'ENTERPRISE',
    badge: 'Enterprise',
    highlightFeatures: [
      'Multi-warehouse & multi-location bin tracking',
      'Batch/Serial number tracking & expiration control',
      'Real-time stock movement ledger (Inbound / Outbound / Transfer)',
      'Low stock automated reorder points & purchase requests',
    ],
    capabilities: [
      { title: 'Real-Time Stock', description: 'Zero-discrepancy inventory sync across all fulfillment hubs.' },
      { title: 'Barcode Workflows', description: 'Fast mobile scanning for receiving, picking, and packing.' },
    ],
  },

  analytics: {
    id: 'analytics',
    name: 'Omyxia Analytics & BI',
    shortName: 'BI & Reports',
    tagline: 'Executive Dashboards, ClickHouse BI & Custom Reports',
    description: 'Transform multi-tenant operational data into real-time business intelligence with interactive charts and automated exports.',
    category: 'intelligence',
    route: '/analytics',
    iconName: 'BarChart3',
    minPlanTier: 'PRO',
    badge: 'Pro',
    highlightFeatures: [
      'Sub-second analytical queries powered by ClickHouse',
      'Custom drag-and-drop KPI widget builder',
      'Automated scheduled report distribution (PDF/Excel)',
      'Cross-service operational data aggregation',
    ],
    capabilities: [
      { title: 'Instant Insights', description: 'Interactive graphs covering revenue, attendance, and stock turnover.' },
      { title: 'Scheduled Reports', description: 'Receive daily or weekly summary digests directly in email or Slack.' },
    ],
  },

  governance: {
    id: 'governance',
    name: 'Omyxia Governance & Audit',
    shortName: 'Governance',
    tagline: 'WORM Immutable Audit Logs & PDPA Compliance Portal',
    description: 'Enterprise data compliance with tamper-proof audit trails, access request workflows, and retention policy enforcement.',
    category: 'governance',
    route: '/governance',
    iconName: 'ShieldCheck',
    minPlanTier: 'ENTERPRISE',
    badge: 'Enterprise',
    highlightFeatures: [
      'Write-Once-Read-Many (WORM) tamper-evident audit logging',
      'Thailand PDPA Subject Access Request (SAR) management',
      'Automated data masking & anonymization engine',
      'Exportable compliance audit packages for external auditors',
    ],
    capabilities: [
      { title: 'Tamper-Proof Audit', description: 'Cryptographically hashed event streams verifiable by auditors.' },
      { title: 'PDPA Readiness', description: 'Full compliance tooling for consent and data subject rights.' },
    ],
  },
};

/**
 * Ordered list of microservices for Portal Navigation
 */
export const PORTAL_NAVIGATION_SERVICES: MicroserviceMeta[] = [
  MICROSERVICES_REGISTRY.core,
  MICROSERVICES_REGISTRY.workspace,
  MICROSERVICES_REGISTRY.hrm,
  MICROSERVICES_REGISTRY.crm,
  MICROSERVICES_REGISTRY.erp,
  MICROSERVICES_REGISTRY.wms,
  MICROSERVICES_REGISTRY.analytics,
  MICROSERVICES_REGISTRY.governance,
];
