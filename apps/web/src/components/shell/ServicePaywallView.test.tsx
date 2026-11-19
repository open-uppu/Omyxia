import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { ServicePaywallView } from './ServicePaywallView';
import { PortalEntitlementsProvider } from './PortalEntitlementsContext';
import type { ServiceAccessContext } from '@omyxia/shared-types';

const mockContext: ServiceAccessContext = {
  tenantId: 'tenant-wms',
  userId: 'user-wms',
  role: 'ADMIN',
  planTier: 'STARTER',
  entitledServices: ['core'],
  enabledFeatures: [],
  isSuspended: false,
};

describe('ServicePaywallView', () => {
  it('renders paywall view for WMS microservice with capabilities and upgrade button', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <ServicePaywallView serviceId="wms" />
      </PortalEntitlementsProvider>
    );

    expect(screen.getByTestId('service-paywall-view')).toBeInTheDocument();
    expect(screen.getByText('Omyxia WMS & Logistics')).toBeInTheDocument();
    expect(screen.getByText(/Plan Upgrade Required/i)).toBeInTheDocument();
    expect(screen.getByText(/STARTER/i)).toBeInTheDocument();

    // Check capabilities
    expect(screen.getByText('Real-Time Stock')).toBeInTheDocument();
    expect(screen.getByText('Barcode Workflows')).toBeInTheDocument();

    // Back link
    const backLink = screen.getByTestId('paywall-back-link');
    expect(backLink).toHaveAttribute('href', '/dashboard');

    // Upgrade CTA
    const upgradeBtn = screen.getByTestId('paywall-view-upgrade-btn');
    expect(upgradeBtn).toHaveAttribute('href', expect.stringContaining('/admin/plans?highlight=wms'));
  });
});
