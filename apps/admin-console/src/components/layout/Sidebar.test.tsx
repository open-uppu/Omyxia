import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { EntitlementsProvider } from '@/components/entitlements';
import type { Entitlements } from '@omyxia/shared-types';
import React from 'react';

function makeEntitlements(
  overrides: Partial<Entitlements>['features'] = {}
): Entitlements {
  return {
    tenantId: 't-test',
    plan: 'PRO',
    planLabel: 'Pro',
    generatedAt: '2026-07-05T12:00:00.000Z',
    features: {
      'module.email': true,
      'module.crm': false,
      'admin.tenants': true,
      'admin.plans': true,
      'admin.audit': false,
      ...overrides,
    },
    limits: { 'limit.maxUsers': 25 },
    usage: { 'limit.maxUsers': 5 },
  };
}

function renderWithEntitlements(
  payload: Entitlements | null,
  activeHref = '/dashboard'
) {
  if (payload) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }
  return render(
    <EntitlementsProvider>
      <Sidebar activeHref={activeHref} />
    </EntitlementsProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sidebar', () => {
  it('renders all five nav items when entitlements allow every flag', async () => {
    renderWithEntitlements(
      makeEntitlements({
        'admin.tenants': true,
        'admin.plans': true,
        'admin.audit': true,
      })
    );
    for (const key of ['dashboard', 'tenants', 'plans', 'audit', 'settings']) {
      expect(await screen.findByTestId(`sidebar-link-${key}`)).toBeInTheDocument();
    }
  });

  it('hides nav items whose feature flag is false (P3.2)', async () => {
    renderWithEntitlements(
      makeEntitlements({
        // PRO plan: tenants/plans visible, audit gated.
        'admin.tenants': true,
        'admin.plans': true,
        'admin.audit': false,
      })
    );
    // Tenants + plans + dashboard + settings are visible (settings has
    // no feature flag, so it's always shown).
    expect(await screen.findByTestId('sidebar-link-tenants')).toBeInTheDocument();
    expect(await screen.findByTestId('sidebar-link-plans')).toBeInTheDocument();
    // Audit must NOT be in the DOM after hydration.
    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-link-audit')).not.toBeInTheDocument();
    });
  });

  it('hides Plans for FREE tenants (no admin.plans)', async () => {
    renderWithEntitlements(
      makeEntitlements({
        'admin.tenants': true,
        'admin.plans': false,
        'admin.audit': false,
      })
    );
    expect(await screen.findByTestId('sidebar-link-tenants')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-link-plans')).not.toBeInTheDocument();
    });
  });

  it('marks the active link with aria-current + data-active', async () => {
    renderWithEntitlements(
      makeEntitlements({ 'admin.tenants': true }),
      '/tenants'
    );
    const tenants = await screen.findByTestId('sidebar-link-tenants');
    expect(tenants.getAttribute('aria-current')).toBe('page');
    expect(tenants.getAttribute('data-active')).toBe('true');

    const dashboard = screen.getByTestId('sidebar-link-dashboard');
    expect(dashboard.getAttribute('aria-current')).toBeNull();
    expect(dashboard.getAttribute('data-active')).toBeNull();
  });

  it('highlights a parent for nested routes', async () => {
    renderWithEntitlements(
      makeEntitlements({ 'admin.tenants': true }),
      '/tenants/abc-123/edit'
    );
    const tenants = await screen.findByTestId('sidebar-link-tenants');
    expect(tenants.getAttribute('aria-current')).toBe('page');
  });

  it('renders the brand header', async () => {
    renderWithEntitlements(makeEntitlements());
    expect(await screen.findByText(/Omyxia Admin/i)).toBeInTheDocument();
  });

  it('falls back to no gated items when entitlements fail to load', () => {
    // No fetch mock → provider stays loading → useFeature returns
    // false for every flag → only items without a feature flag are
    // visible (dashboard + settings).
    render(
      <EntitlementsProvider>
        <Sidebar activeHref="/dashboard" />
      </EntitlementsProvider>
    );
    // Dashboard + settings are unconditional.
    expect(screen.getByTestId('sidebar-link-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-settings')).toBeInTheDocument();
    // Gated items are absent.
    expect(screen.queryByTestId('sidebar-link-tenants')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-plans')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-audit')).not.toBeInTheDocument();
  });
});