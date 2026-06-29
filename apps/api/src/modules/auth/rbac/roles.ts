/**
 * RBAC Role Enum
 *
 * Maps 1:1 to the Prisma `TenantRole` enum. Kept as a TS literal union so it
 * can be used as a type for `@Roles()` decorators without importing Prisma
 * types into the runtime (keeps decorator metadata lightweight).
 */
export const ROLES = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'HR_MANAGER', 'ACCOUNTANT', 'MANAGER', 'MEMBER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Action resources that can be permissioned.
 * Use the wildcard '*' for super-admin override.
 */
export const ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'manage', // full manage (covers create/update/delete)
  'audit.read',
  'tenant.manage',
  'user.manage',
  'billing.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Permission matrix — Role × Action -> boolean.
 *
 * Hierarchy: SUPER_ADMIN > OWNER > ADMIN > HR_MANAGER/ACCOUNTANT/MANAGER > MEMBER > VIEWER
 * `manage` implies all crud operations for that role's domain.
 */
export const PERMISSIONS: Record<Role, ReadonlyArray<Action>> = {
  SUPER_ADMIN: ['*'],
  OWNER: ['manage', 'audit.read', 'tenant.manage', 'user.manage', 'billing.manage', 'read', 'create', 'update', 'delete'],
  ADMIN: ['manage', 'audit.read', 'user.manage', 'read', 'create', 'update', 'delete'],
  HR_MANAGER: ['read', 'create', 'update'], // HR domain writes (employees, leave, payroll)
  ACCOUNTANT: ['read', 'create', 'update'], // ERP/finance domain writes (journals, invoices, taxes)
  MANAGER: ['read', 'create', 'update'], // team-scoped updates (employees under them, projects)
  MEMBER: ['read', 'create', 'update'], // authenticated member — limited domain writes
  VIEWER: ['read'],
};

/**
 * Decide whether `role` is allowed to perform `action`.
 * Wildcard '*' grants everything.
 *
 * 'manage' is a coarse verb that implies read/create/update/delete (the four
 * CRUD verbs). It does NOT imply namespaced admin actions like 'tenant.manage'
 * or 'billing.manage' — those must be granted explicitly per role.
 */
const CRUD_VERBS: ReadonlySet<Action> = new Set<Action>(['read', 'create', 'update', 'delete']);

export function can(role: Role | string | undefined, action: Action): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[role as Role];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  if (allowed.includes(action)) return true;
  // 'manage' implies crud verbs but not namespaced admin verbs
  if (allowed.includes('manage') && CRUD_VERBS.has(action)) return true;
  return false;
}

/** Type guard for Role strings coming from JWT or DB */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Coerce arbitrary input into a known Role, defaulting to VIEWER (least privilege) */
export function coerceRole(value: unknown): Role {
  return isRole(value) ? value : 'VIEWER';
}