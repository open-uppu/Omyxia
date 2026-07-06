/**
 * omyxia v2.0.0 P4.1 — Internal fixtures used by service tests.
 *
 * Pulls Prisma `Plan` / `AddOn` / `Tenant` stubs that match the catalog
 * seeded by P1.2 (Free/Pro/Enterprise). Used by catalog + sync specs.
 */

import type { AddOn, Plan, PlanTier, Tenant } from '@prisma/client';

export const planRecord = (overrides: Partial<Plan> = {}): Plan => ({
  id: 'plan_pro_id',
  name: 'Pro',
  tier: 'PRO' satisfies PlanTier,
  price: '99.00' as unknown as Plan['price'],
  description: 'For growing teams',
  isActive: true,
  sortOrder: 1,
  stripePriceId: null,
  stripeProductId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const addOnRecord = (overrides: Partial<AddOn> = {}): AddOn => ({
  id: 'addon_extra_storage_id',
  name: 'Extra Storage',
  slug: 'extra_storage',
  price: '20.00' as unknown as AddOn['price'],
  appliesTo: 'ALL',
  description: '+500GB storage',
  isActive: true,
  stripePriceId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const tenantRecord = (overrides: Partial<Tenant> = {}): Tenant => ({
  id: 'tenant_acme_id',
  slug: 'acme',
  name: 'ACME',
  plan: 'GROWTH',
  status: 'ACTIVE',
  settings: {},
  stripeCustomerId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});
