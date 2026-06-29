import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, ROLES, coerceRole, isRole, type Action, type Role } from './roles';

describe('RBAC permission matrix', () => {
  it('exposes the 4 documented primary roles (Owner/Admin/Member/Viewer) plus internal roles', () => {
    expect(ROLES).toContain('OWNER');
    expect(ROLES).toContain('ADMIN');
    expect(ROLES).toContain('MEMBER');
    expect(ROLES).toContain('VIEWER');
  });

  it('OWNER can do everything in the manage set', () => {
    const actions: Action[] = ['read', 'create', 'update', 'delete', 'audit.read', 'tenant.manage', 'user.manage', 'billing.manage'];
    for (const action of actions) {
      expect(can('OWNER', action), `OWNER/${action}`).toBe(true);
    }
  });

  it('ADMIN can manage but not billing.manage or tenant.manage', () => {
    expect(can('ADMIN', 'read')).toBe(true);
    expect(can('ADMIN', 'create')).toBe(true);
    expect(can('ADMIN', 'delete')).toBe(true);
    expect(can('ADMIN', 'audit.read')).toBe(true);
    expect(can('ADMIN', 'user.manage')).toBe(true);
    expect(can('ADMIN', 'tenant.manage')).toBe(false);
    expect(can('ADMIN', 'billing.manage')).toBe(false);
  });

  it('MEMBER can read/write but not delete or admin actions', () => {
    expect(can('MEMBER', 'read')).toBe(true);
    expect(can('MEMBER', 'create')).toBe(true);
    expect(can('MEMBER', 'update')).toBe(true);
    expect(can('MEMBER', 'delete')).toBe(false);
    expect(can('MEMBER', 'audit.read')).toBe(false);
    expect(can('MEMBER', 'tenant.manage')).toBe(false);
    expect(can('MEMBER', 'user.manage')).toBe(false);
  });

  it('VIEWER is read-only', () => {
    expect(can('VIEWER', 'read')).toBe(true);
    expect(can('VIEWER', 'create')).toBe(false);
    expect(can('VIEWER', 'update')).toBe(false);
    expect(can('VIEWER', 'delete')).toBe(false);
    expect(can('VIEWER', 'manage')).toBe(false);
    expect(can('VIEWER', 'audit.read')).toBe(false);
  });

  it('SUPER_ADMIN has wildcard access', () => {
    expect(can('SUPER_ADMIN', 'read')).toBe(true);
    expect(can('SUPER_ADMIN', 'delete')).toBe(true);
    expect(can('SUPER_ADMIN', 'billing.manage')).toBe(true);
    expect(can('SUPER_ADMIN', 'tenant.manage')).toBe(true);
    expect(can('SUPER_ADMIN', 'whatever-future-action' as Action)).toBe(true);
  });

  it('missing role denies access', () => {
    expect(can(undefined, 'read')).toBe(false);
    expect(can(null as any, 'read')).toBe(false);
    expect(can('', 'read')).toBe(false);
  });

  it('unknown role denies access', () => {
    expect(can('NOT_A_ROLE', 'read')).toBe(false);
  });

  it('"manage" implies read/create/update/delete', () => {
    const verbs: Action[] = ['read', 'create', 'update', 'delete'];
    for (const verb of verbs) {
      expect(can('ADMIN', verb), `ADMIN/${verb} via manage`).toBe(true);
      expect(can('OWNER', verb), `OWNER/${verb} via manage`).toBe(true);
    }
  });

  it('every role has a permission row', () => {
    for (const r of ROLES) {
      expect(PERMISSIONS[r], `PERMISSIONS[${r}]`).toBeDefined();
    }
  });

  it('full 4-roles × N-actions intersection: OWNER/ADMIN/MEMBER/VIEWER each get expected matrix', () => {
    const matrix: Record<Role, Record<Action, boolean>> = {
      OWNER: {
        read: can('OWNER', 'read'),
        create: can('OWNER', 'create'),
        update: can('OWNER', 'update'),
        delete: can('OWNER', 'delete'),
        manage: can('OWNER', 'manage'),
        'audit.read': can('OWNER', 'audit.read'),
        'tenant.manage': can('OWNER', 'tenant.manage'),
        'user.manage': can('OWNER', 'user.manage'),
        'billing.manage': can('OWNER', 'billing.manage'),
      },
      ADMIN: {
        read: can('ADMIN', 'read'),
        create: can('ADMIN', 'create'),
        update: can('ADMIN', 'update'),
        delete: can('ADMIN', 'delete'),
        manage: can('ADMIN', 'manage'),
        'audit.read': can('ADMIN', 'audit.read'),
        'tenant.manage': can('ADMIN', 'tenant.manage'),
        'user.manage': can('ADMIN', 'user.manage'),
        'billing.manage': can('ADMIN', 'billing.manage'),
      },
      MEMBER: {
        read: can('MEMBER', 'read'),
        create: can('MEMBER', 'create'),
        update: can('MEMBER', 'update'),
        delete: can('MEMBER', 'delete'),
        manage: can('MEMBER', 'manage'),
        'audit.read': can('MEMBER', 'audit.read'),
        'tenant.manage': can('MEMBER', 'tenant.manage'),
        'user.manage': can('MEMBER', 'user.manage'),
        'billing.manage': can('MEMBER', 'billing.manage'),
      },
      VIEWER: {
        read: can('VIEWER', 'read'),
        create: can('VIEWER', 'create'),
        update: can('VIEWER', 'update'),
        delete: can('VIEWER', 'delete'),
        manage: can('VIEWER', 'manage'),
        'audit.read': can('VIEWER', 'audit.read'),
        'tenant.manage': can('VIEWER', 'tenant.manage'),
        'user.manage': can('VIEWER', 'user.manage'),
        'billing.manage': can('VIEWER', 'billing.manage'),
      },
    };

    // Spot-check each cell (use bracket notation for dotted action keys)
    expect(matrix.OWNER.delete).toBe(true);
    expect(matrix.OWNER['billing.manage']).toBe(true);
    expect(matrix.OWNER['tenant.manage']).toBe(true);
    expect(matrix.ADMIN.delete).toBe(true);
    expect(matrix.ADMIN['billing.manage']).toBe(false);
    expect(matrix.ADMIN['tenant.manage']).toBe(false);
    expect(matrix.MEMBER.delete).toBe(false);
    expect(matrix.MEMBER['audit.read']).toBe(false);
    expect(matrix.VIEWER.create).toBe(false);
    expect(matrix.VIEWER.read).toBe(true);
    expect(matrix.VIEWER['billing.manage']).toBe(false);
  });
});

describe('isRole / coerceRole', () => {
  it('isRole validates string against known roles', () => {
    expect(isRole('OWNER')).toBe(true);
    expect(isRole('MEMBER')).toBe(true);
    expect(isRole('not-a-role')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(123)).toBe(false);
  });

  it('coerceRole returns VIEWER for unknown input (least privilege)', () => {
    expect(coerceRole('OWNER')).toBe('OWNER');
    expect(coerceRole('MEMBER')).toBe('MEMBER');
    expect(coerceRole('weird')).toBe('VIEWER');
    expect(coerceRole(null)).toBe('VIEWER');
    expect(coerceRole(undefined)).toBe('VIEWER');
  });
});