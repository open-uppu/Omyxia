import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { ServicePaywallModal } from './ServicePaywallModal';
import { PortalEntitlementsProvider } from './PortalEntitlementsContext';
import type { ServiceAccessContext } from '@omyxia/shared-types';

const mockContext: ServiceAccessContext = {
  tenantId: 'tenant-test',
  userId: 'user-test',
  role: 'OWNER',
  planTier: 'STARTER',
  entitledServices: ['core'],
  enabledFeatures: [],
  isSuspended: false,
};

describe('ServicePaywallModal', () => {
  it('does not render when closed', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <ServicePaywallModal isOpen={false} serviceId="erp" />
      </PortalEntitlementsProvider>
    );

    expect(screen.queryByTestId('service-paywall-modal')).not.toBeInTheDocument();
  });

  it('renders correctly for ERP microservice when open', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <ServicePaywallModal isOpen={true} serviceId="erp" />
      </PortalEntitlementsProvider>
    );

    expect(screen.getByTestId('service-paywall-modal')).toBeInTheDocument();
    expect(screen.getByTestId('paywall-service-name')).toHaveTextContent('Omyxia ERP & Finance');
    expect(screen.getByTestId('paywall-plan-badge')).toHaveTextContent(/Pro Plan/i);
    expect(screen.getByText(/STARTER/i)).toBeInTheDocument();

    // Check highlights
    expect(screen.getAllByText(/Double-entry General Ledger/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Thai Revenue Department WHT/i)).toBeInTheDocument();

    // Upgrade CTA
    const cta = screen.getByTestId('paywall-upgrade-cta');
    expect(cta).toHaveAttribute('href', expect.stringContaining('/admin/plans?highlight=erp'));
  });

  it('calls onClose when close button or cancel button is clicked', () => {
    const handleClose = vi.fn();

    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <ServicePaywallModal isOpen={true} serviceId="wms" onClose={handleClose} />
      </PortalEntitlementsProvider>
    );

    fireEvent.click(screen.getByTestId('paywall-close-btn'));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('paywall-cancel-btn'));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape key press', () => {
    const handleClose = vi.fn();

    render(
      <PortalEntitlementsProvider initialContext={mockContext}>
        <ServicePaywallModal isOpen={true} serviceId="analytics" onClose={handleClose} />
      </PortalEntitlementsProvider>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
