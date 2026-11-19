import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { DynamicNav } from './DynamicNav';
import { PortalEntitlementsProvider } from './PortalEntitlementsContext';
import type { ServiceAccessContext } from '@omyxia/shared-types';

const mockContext: ServiceAccessContext = {
  tenantId: 'tenant-nav',
  userId: 'user-nav',
  role: 'ADMIN',
  planTier: 'STARTER',
  entitledServices: ['core', 'workspace', 'hrm'],
  enabledFeatures: ['HRM_CORE'],
  isSuspended: false,
};

describe('DynamicNav', () => {
  it('renders entitled services as clickable links and unentitled as locked buttons', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <DynamicNav />
      </PortalEntitlementsProvider>
    );

    // Entitled services (core, workspace, hrm)
    expect(screen.getByTestId('nav-item-core')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-hrm')).toBeInTheDocument();

    // Gated services (erp, wms, governance)
    expect(screen.getByTestId('nav-item-erp-locked')).toBeInTheDocument();
    expect(screen.getByTestId('badge-locked-erp')).toHaveTextContent(/Pro/i);

    expect(screen.getByTestId('nav-item-wms-locked')).toBeInTheDocument();
    expect(screen.getByTestId('badge-locked-wms')).toHaveTextContent(/Enterprise/i);
  });

  it('triggers paywall when a locked service item is clicked', () => {
    let activePaywallService: string | null = null;

    function PaywallMonitor() {
      return (
        <PortalEntitlementsProvider initialContext={mockContext}>
          <DynamicNav />
        </PortalEntitlementsProvider>
      );
    }

    render(<PaywallMonitor />);

    const lockedErpBtn = screen.getByTestId('nav-item-erp-locked');
    fireEvent.click(lockedErpBtn);

    // DynamicNav calls openPaywall internally
    expect(screen.getByTestId('badge-locked-erp')).toBeInTheDocument();
  });

  it('filters to entitled services only when filterEntitledOnly=true', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <DynamicNav filterEntitledOnly={true} />
      </PortalEntitlementsProvider>
    );

    // Entitled items are present
    expect(screen.getByTestId('nav-item-core')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-hrm')).toBeInTheDocument();

    // Locked items are filtered out
    expect(screen.queryByTestId('nav-item-erp-locked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-item-wms-locked')).not.toBeInTheDocument();
  });

  it('displays the current plan in the navigation footer', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <DynamicNav />
      </PortalEntitlementsProvider>
    );

    expect(screen.getByTestId('nav-plan-summary')).toHaveTextContent(/STARTER PLAN/i);
    expect(screen.getByTestId('nav-upgrade-link')).toHaveAttribute('href', '/admin/plans');
  });
});
