import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { RemoteMicrofrontendContainer } from './RemoteMicrofrontendContainer';
import { PortalEntitlementsProvider } from './PortalEntitlementsContext';
import type { ServiceAccessContext } from '@omyxia/shared-types';

const mockStarterContext: ServiceAccessContext = {
  tenantId: 'tenant-mfe',
  userId: 'user-mfe',
  role: 'MEMBER',
  planTier: 'STARTER',
  entitledServices: ['core', 'hrm'],
  enabledFeatures: ['HRM_CORE'],
  isSuspended: false,
};

describe('RemoteMicrofrontendContainer', () => {
  it('renders ServicePaywallView when tenant is not entitled to the requested microservice', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockStarterContext}>
        <RemoteMicrofrontendContainer serviceId="erp" />
      </PortalEntitlementsProvider>
    );

    // Should render the paywall gate instead of loading the remote bundle
    expect(screen.getByTestId('remote-container-paywall-gate')).toBeInTheDocument();
    expect(screen.getByTestId('service-paywall-view')).toBeInTheDocument();
    expect(screen.getByText('Omyxia ERP & Finance')).toBeInTheDocument();
  });

  it('renders active container or children when tenant is entitled', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockStarterContext}>
        <RemoteMicrofrontendContainer serviceId="hrm">
          <div data-testid="hrm-remote-app">HRM Remote Bundle Mounted</div>
        </RemoteMicrofrontendContainer>
      </PortalEntitlementsProvider>
    );

    expect(screen.queryByTestId('remote-container-paywall-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('remote-mfe-hrm')).toBeInTheDocument();
    expect(screen.getByTestId('hrm-remote-app')).toHaveTextContent('HRM Remote Bundle Mounted');
  });

  it('shows loading state when remote bundle is being fetched and no static children provided', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockStarterContext}>
        <RemoteMicrofrontendContainer serviceId="hrm" />
      </PortalEntitlementsProvider>
    );

    expect(screen.getByTestId('mfe-loading-state')).toBeInTheDocument();
    expect(screen.getByText(/Connecting to Omyxia HRM/i)).toBeInTheDocument();
  });
});
