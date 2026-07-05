// @vitest-environment jsdom
//
// Tests for /upgrade (P3.2).
//
// We mock `useSearchParams` per-test so we can drive the URL state
// without spinning up the Next router runtime.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import UpgradePage from './page';
import { EntitlementsProvider } from '@/components/entitlements';
import type { Entitlements } from '@omyxia/shared-types';
import React from 'react';

const searchParamsMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/upgrade',
}));

function makeEntitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    tenantId: 't-test',
    plan: 'FREE',
    planLabel: 'Free',
    generatedAt: '2026-07-05T12:00:00.000Z',
    features: {
      'admin.tenants': true,
      'admin.plans': false,
      'admin.audit': false,
    },
    limits: { 'limit.maxUsers': 3 },
    usage: { 'limit.maxUsers': 1 },
    ...overrides,
  };
}

function renderUpgrade(payload: Entitlements) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  return render(
    <EntitlementsProvider>
      <UpgradePage />
    </EntitlementsProvider>
  );
}

beforeEach(() => {
  searchParamsMock.mockReturnValue(new URLSearchParams());
});

afterEach(() => {
  vi.restoreAllMocks();
  searchParamsMock.mockReset();
});

describe('/upgrade page', () => {
  it('renders the catalog view when no feature is in the URL', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    renderUpgrade(makeEntitlements());
    expect(await screen.findByTestId('upgrade-page')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-catalog')).toBeInTheDocument();
    // The catalog row for CRM must be present.
    expect(screen.getByTestId('catalog-row-module.crm')).toBeInTheDocument();
  });

  it('renders a hint card when feature=admin.audit', async () => {
    const params = new URLSearchParams();
    params.set('feature', 'admin.audit');
    params.set('label', 'Audit');
    params.set('from', '/audit');
    searchParamsMock.mockReturnValue(params);

    renderUpgrade(makeEntitlements());
    expect(await screen.findByTestId('upgrade-page')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-title')).toHaveTextContent('Audit');
    expect(screen.getByTestId('upgrade-subtitle')).toHaveTextContent(/ENTERPRISE/);
    // Plan chips: FREE (current) + ENTERPRISE (recommended) + PRO (other).
    expect(screen.getByTestId('upgrade-plan-FREE')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('upgrade-plan-ENTERPRISE')).toHaveAttribute(
      'data-state',
      'recommended'
    );
    expect(screen.getByTestId('upgrade-plan-PRO')).toHaveAttribute('data-state', 'other');
    // The unlock bullets are present.
    expect(screen.getByTestId('upgrade-unlocks')).toBeInTheDocument();
  });

  it('recommends PRO for module.* features', async () => {
    const params = new URLSearchParams();
    params.set('feature', 'module.crm');
    searchParamsMock.mockReturnValue(params);
    renderUpgrade(makeEntitlements({ plan: 'FREE' }));
    expect(
      await screen.findByTestId('upgrade-plan-PRO')
    ).toHaveAttribute('data-state', 'recommended');
  });

  it('renders a mailto CTA with subject + body pre-filled', async () => {
    const params = new URLSearchParams();
    params.set('feature', 'module.crm');
    params.set('label', 'CRM');
    searchParamsMock.mockReturnValue(params);
    renderUpgrade(makeEntitlements({ plan: 'FREE' }));
    const cta = await screen.findByTestId('upgrade-cta-mailto');
    const href = cta.getAttribute('href') || '';
    expect(href.startsWith('mailto:')).toBe(true);
    expect(href).toContain(encodeURIComponent('CRM'));
    expect(href).toContain('subject=');
    expect(href).toContain('body=');
  });

  it('falls back to a human label from the key when none is provided', async () => {
    const params = new URLSearchParams();
    params.set('feature', 'admin.audit');
    searchParamsMock.mockReturnValue(params);
    renderUpgrade(makeEntitlements());
    // No label query → derive "Audit" from the key.
    const title = await screen.findByTestId('upgrade-title');
    expect(title).toHaveTextContent(/Audit/);
  });

  it('renders the Back link with the ?from= target', async () => {
    const params = new URLSearchParams();
    params.set('feature', 'admin.audit');
    params.set('from', '/audit');
    searchParamsMock.mockReturnValue(params);
    renderUpgrade(makeEntitlements());
    const back = await screen.findByTestId('upgrade-back');
    expect(back.getAttribute('href')).toBe('/audit');
  });

  it('defaults the Back link to /dashboard when no from is provided', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    renderUpgrade(makeEntitlements());
    const back = await screen.findByTestId('upgrade-back');
    expect(back.getAttribute('href')).toBe('/dashboard');
  });

  it('renders the catalog rows with unlocked/needed status', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    // FREE plan — only `module.email` is enabled by default.
    renderUpgrade(makeEntitlements());
    const crmRow = await screen.findByTestId('catalog-row-module.crm');
    expect(crmRow.getAttribute('data-unlocked')).toBe('false');
    // Audit row is also gated.
    const auditRow = await screen.findByTestId('catalog-row-admin.audit');
    expect(auditRow.getAttribute('data-unlocked')).toBe('false');
  });

  it('shows a row as unlocked when the current plan covers it', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    // ENTERPRISE plan → everything is unlocked.
    renderUpgrade(makeEntitlements({ plan: 'ENTERPRISE' }));
    const auditRow = await screen.findByTestId('catalog-row-admin.audit');
    await waitFor(() => {
      expect(auditRow.getAttribute('data-unlocked')).toBe('true');
    });
  });
});