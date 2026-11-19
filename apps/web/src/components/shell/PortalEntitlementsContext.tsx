'use client';

import * as React from 'react';
import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import {
  evaluateServiceAccess,
  type MicroserviceId,
  type ServiceAccessContext,
  type ServiceAccessDecision,
} from '@omyxia/shared-types';

export interface PaywallState {
  isOpen: boolean;
  serviceId: MicroserviceId | null;
  decision: ServiceAccessDecision | null;
}

export interface PortalEntitlementsContextValue {
  context: ServiceAccessContext;
  checkAccess: (serviceId: MicroserviceId) => ServiceAccessDecision;
  openPaywall: (serviceId: MicroserviceId, decision?: ServiceAccessDecision) => void;
  closePaywall: () => void;
  activePaywall: PaywallState;
}

const PortalEntitlementsContext = createContext<PortalEntitlementsContextValue | null>(null);

export interface PortalEntitlementsProviderProps {
  children: React.ReactNode;
  initialContext: ServiceAccessContext;
}

export function PortalEntitlementsProvider({
  children,
  initialContext,
}: PortalEntitlementsProviderProps) {
  const [context, setContext] = useState<ServiceAccessContext>(initialContext);
  const [activePaywall, setActivePaywall] = useState<PaywallState>({
    isOpen: false,
    serviceId: null,
    decision: null,
  });

  // Keep context synced if initialContext prop updates
  React.useEffect(() => {
    setContext(initialContext);
  }, [initialContext]);

  const checkAccess = useCallback(
    (serviceId: MicroserviceId): ServiceAccessDecision => {
      return evaluateServiceAccess(context, serviceId);
    },
    [context]
  );

  const openPaywall = useCallback(
    (serviceId: MicroserviceId, customDecision?: ServiceAccessDecision) => {
      const decision = customDecision || evaluateServiceAccess(context, serviceId);
      setActivePaywall({
        isOpen: true,
        serviceId,
        decision,
      });
    },
    [context]
  );

  const closePaywall = useCallback(() => {
    setActivePaywall((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  const value = useMemo<PortalEntitlementsContextValue>(
    () => ({
      context,
      checkAccess,
      openPaywall,
      closePaywall,
      activePaywall,
    }),
    [context, checkAccess, openPaywall, closePaywall, activePaywall]
  );

  return (
    <PortalEntitlementsContext.Provider value={value}>
      {children}
    </PortalEntitlementsContext.Provider>
  );
}

export function usePortalEntitlements(): PortalEntitlementsContextValue {
  const ctx = useContext(PortalEntitlementsContext);
  if (!ctx) {
    throw new Error('usePortalEntitlements must be used within a PortalEntitlementsProvider');
  }
  return ctx;
}
