import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { PortalAppShell } from './PortalAppShell';
import type { ServiceAccessContext } from '@omyxia/shared-types';
import type { TenantSummary } from '@/lib/api';

const mockUser = {
  id: 'usr-1',
  email: 'dev@omyxia.app',
  name: 'Dev User',
};

const mockCurrentTenant: TenantSummary = {
  id: 'ten-1',
  slug: 'acme-corp',
  name: 'Acme Corp',
  role: 'ADMIN',
};

const mockTenants: TenantSummary[] = [mockCurrentTenant];

const mockContext: ServiceAccessContext = {
  tenantId: 'ten-1',
  userId: 'usr-1',
  role: 'ADMIN',
  planTier: 'STARTER',
  entitledServices: ['core', 'workspace', 'hrm'],
  enabledFeatures: ['HRM_CORE'],
  isSuspended: false,
};

describe('PortalAppShell', () => {
  it('renders topbar, desktop sidebar, and main children content', () => {
    render(
      <PortalAppShell
        user={mockUser}
        currentTenant={mockCurrentTenant}
        tenants={mockTenants}
        entitlementsContext={mockContext}
      >
        <div data-testid="dashboard-content">Welcome to Acme Corp</div>
      </PortalAppShell>
    );

    expect(screen.getByTestId('portal-app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('portal-desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-content')).toHaveTextContent('Welcome to Acme Corp');
  });

  it('toggles mobile drawer on mobile toggle button click', () => {
    render(
      <PortalAppShell
        user={mockUser}
        currentTenant={mockCurrentTenant}
        tenants={mockTenants}
        entitlementsContext={mockContext}
      >
        <div>Content</div>
      </PortalAppShell>
    );

    expect(screen.queryByTestId('portal-mobile-drawer')).not.toBeInTheDocument();

    // Click mobile nav toggle
    fireEvent.click(screen.getByTestId('mobile-nav-toggle'));
    expect(screen.getByTestId('portal-mobile-drawer')).toBeInTheDocument();

    // Click close in drawer
    fireEvent.click(screen.getByTestId('mobile-drawer-close'));
    expect(screen.queryByTestId('portal-mobile-drawer')).not.toBeInTheDocument();
  });

  it('opens paywall modal when a locked service item is clicked in navigation', () => {
    render(
      <PortalAppShell
        user={mockUser}
        currentTenant={mockCurrentTenant}
        tenants={mockTenants}
        entitlementsContext={mockContext}
      >
        <div>Content</div>
      </PortalAppShell>
    );

    expect(screen.queryByTestId('service-paywall-modal')).not.toBeInTheDocument();

    // Click ERP (which is locked on STARTER plan)
    const erpLockedBtn = screen.getByTestId('nav-item-erp-locked');
    fireEvent.click(erpLockedBtn);

    // Modal is now open!
    expect(screen.getByTestId('service-paywall-modal')).toBeInTheDocument();
    expect(screen.getByTestId('paywall-service-name')).toHaveTextContent('Omyxia ERP & Finance');
  });
});
