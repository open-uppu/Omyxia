import { describe, it, expect } from 'vitest';
import {
  TenantSchema,
  TenantPlanSchema,
  UserSchema,
} from './index';

describe('Shared types', () => {
  it('TenantSchema validates a tenant', () => {
    const tenant = {
      id: 't1',
      slug: 'acme',
      name: 'Acme Co',
      plan: 'STARTER',
      status: 'ACTIVE',
      createdAt: new Date(),
    };
    expect(() => TenantSchema.parse(tenant)).not.toThrow();
  });

  it('TenantPlanSchema rejects invalid plan', () => {
    expect(() => TenantPlanSchema.parse('INVALID')).toThrow();
  });

  it('UserSchema validates a user', () => {
    const user = {
      id: 'u1',
      email: 'user@example.com',
      name: 'User One',
      locale: 'en',
    };
    expect(() => UserSchema.parse(user)).not.toThrow();
  });
});
