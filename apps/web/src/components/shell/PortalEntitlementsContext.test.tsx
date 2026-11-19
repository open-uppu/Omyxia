import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as React from 'react';
import {
  PortalEntitlementsProvider,
  usePortalEntitlements,
} from './PortalEntitlementsContext';
import type { ServiceAccessContext } from '@omyxia/shared-types';

const mockStarterContext: ServiceAccessContext = {
  tenantId: 'tenant-123',
  userId: 'user-456',
  role: 'ADMIN',
  planTier: 'STARTER',
  entitledServices: ['core', 'hrm'],
  enabledFeatures: ['HRM_CORE'],
  isSuspended: false,
};

function TestConsumer() {
  const { context, checkAccess, openPaywall, closePaywall, activePaywall } =
    usePortalEntitlements();

  const coreDecision = checkAccess('core');
  const erpDecision = checkAccess('erp');

  return (
    <div>
      <div data-testid="tenant-id">{context.tenantId}</div>
      <div data-testid="core-allowed">{coreDecision.allowed ? 'yes' : 'no'}</div>
      <div data-testid="erp-allowed">{erpDecision.allowed ? 'yes' : 'no'}</div>
      <div data-testid="paywall-status">
        {activePaywall.isOpen ? `open:${activePaywall.serviceId}` : 'closed'}
      </div>
      <button
        type="button"
        data-testid="btn-open-erp"
        onClick={() => openPaywall('erp')}
      >
        Open ERP Paywall
      </button>
      <button
        type="button"
        data-testid="btn-close"
        onClick={() => closePaywall()}
      >
        Close Paywall
      </button>
    </div>
  );
}

describe('PortalEntitlementsContext', () => {
  it('throws error when used outside provider', () => {
    // Suppress console.error from React error boundary
    const originalError = console.error;
    console.error = () => {};

    expect(() => render(<TestConsumer />)).toThrow(
      'usePortalEntitlements must be used within a PortalEntitlementsProvider'
    );

    console.error = originalError;
  });

  it('provides context, evaluates access and controls paywall state', () => {
    render(
      <PortalEntitlementsProvider initialContext={mockStarterContext}>
        <TestConsumer />
      </PortalEntitlementsProvider>
    );

    expect(screen.getByTestId('tenant-id')).toHaveTextContent('tenant-123');
    expect(screen.getByTestId('core-allowed')).toHaveTextContent('yes');
    expect(screen.getByTestId('erp-allowed')).toHaveTextContent('no');
    expect(screen.getByTestId('paywall-status')).toHaveTextContent('closed');

    // Trigger openPaywall
    act(() => {
      screen.getByTestId('btn-open-erp').click();
    });

    expect(screen.getByTestId('paywall-status')).toHaveTextContent('open:erp');

    // Trigger closePaywall
    act(() => {
      screen.getByTestId('btn-close').click();
    });

    expect(screen.getByTestId('paywall-status')).toHaveTextContent('closed');
  });

  it('evaluates suspended tenant as blocked for all services except core logic check', () => {
    const suspendedContext: ServiceAccessContext = {
      ...mockStarterContext,
      isSuspended: true,
    };

    render(
      <PortalEntitlementsProvider initialContext={suspendedContext}>
        <TestConsumer />
      </PortalEntitlementsProvider>
    );

    // Suspended tenant is denied even for entitled services
    expect(screen.getByTestId('core-allowed')).toHaveTextContent('no');
    expect(screen.getByTestId('erp-allowed')).toHaveTextContent('no');
  });
});
