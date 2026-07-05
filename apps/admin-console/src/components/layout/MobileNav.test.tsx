import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileNav } from './MobileNav';
import { EntitlementsProvider } from '@/components/entitlements';
import type { Entitlements } from '@omyxia/shared-types';
import React from 'react';

// next/navigation is mocked at the test runner level via vi.mock in setup.
// We can't easily mock `usePathname` from inside a single test file without
// vi.mock hoisting, so this file is a focused render-only smoke test.

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

function makeEntitlements(
  features: Partial<Entitlements>['features'] = {}
): Entitlements {
  return {
    tenantId: 't-test',
    plan: 'PRO',
    planLabel: 'Pro',
    generatedAt: '2026-07-05T12:00:00.000Z',
    features: {
      'admin.tenants': true,
      'admin.plans': true,
      'admin.audit': false,
      ...features,
    },
    limits: { 'limit.maxUsers': 25 },
    usage: { 'limit.maxUsers': 5 },
  };
}

function renderWithEntitlements(
  payload: Entitlements,
  ui: React.ReactElement
) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  return render(<EntitlementsProvider>{ui}</EntitlementsProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('MobileNav', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MobileNav open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the drawer when open with all five links (PRO plan)', async () => {
    renderWithEntitlements(
      makeEntitlements({ 'admin.audit': true }),
      <MobileNav open={true} onClose={() => {}} />
    );
    expect(await screen.findByTestId('mobile-nav')).toBeInTheDocument();
    for (const key of ['dashboard', 'tenants', 'plans', 'audit', 'settings']) {
      expect(await screen.findByTestId(`mobile-nav-link-${key}`)).toBeInTheDocument();
    }
  });

  it('hides nav items whose feature flag is false (P3.2)', async () => {
    renderWithEntitlements(
      makeEntitlements({ 'admin.audit': false }),
      <MobileNav open={true} onClose={() => {}} />
    );
    expect(await screen.findByTestId('mobile-nav-link-tenants')).toBeInTheDocument();
    expect(await screen.findByTestId('mobile-nav-link-plans')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('mobile-nav-link-audit')).not.toBeInTheDocument();
    });
  });

  it('highlights the active item based on usePathname', async () => {
    renderWithEntitlements(
      makeEntitlements(),
      <MobileNav open={true} onClose={() => {}} />
    );
    const dashboard = await screen.findByTestId('mobile-nav-link-dashboard');
    expect(dashboard.getAttribute('aria-current')).toBe('page');
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    renderWithEntitlements(
      makeEntitlements(),
      <MobileNav open={true} onClose={onClose} />
    );
    await userEvent.click(await screen.findByTestId('mobile-nav-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    renderWithEntitlements(
      makeEntitlements(),
      <MobileNav open={true} onClose={onClose} />
    );
    await screen.findByTestId('mobile-nav');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onClose when a link is clicked', async () => {
    const onClose = vi.fn();
    renderWithEntitlements(
      makeEntitlements(),
      <MobileNav open={true} onClose={onClose} />
    );
    const tenants = await screen.findByTestId('mobile-nav-link-tenants');
    await userEvent.click(tenants);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});