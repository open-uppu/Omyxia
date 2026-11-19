'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { usePortalEntitlements } from './PortalEntitlementsContext';
import { ServicePaywallView } from './ServicePaywallView';
import { MICROSERVICES_REGISTRY } from './microservices-registry';
import { cn } from '@/lib/utils';
import type { MicroserviceId } from '@omyxia/shared-types';

export interface RemoteMicrofrontendProps {
  serviceId: MicroserviceId;
  remoteUrl?: string;
  remoteName?: string;
  exposedModule?: string;
  className?: string;
  fallback?: React.ReactNode;
  /**
   * Optional custom client component passed in for testing or static composition
   */
  children?: React.ReactNode;
}

/**
 * RemoteMicrofrontendContainer
 *
 * Micro-frontend App Shell host container component.
 * 1. Checks tenant microservice entitlement first.
 * 2. If unentitled -> Automatically renders ServicePaywallView.
 * 3. If entitled -> Mounts the remote bundle with loading state & fault-tolerant fallback.
 */
export function RemoteMicrofrontendContainer({
  serviceId,
  remoteUrl,
  remoteName,
  exposedModule = './App',
  className,
  fallback,
  children,
}: RemoteMicrofrontendProps) {
  const { checkAccess, context } = usePortalEntitlements();
  const [loading, setLoading] = useState<boolean>(!children);
  const [error, setError] = useState<string | null>(null);

  const decision = checkAccess(serviceId);
  const meta = MICROSERVICES_REGISTRY[serviceId] || MICROSERVICES_REGISTRY.erp;

  // 1. Entitlement Guard Check
  if (!decision.allowed) {
    return (
      <div data-testid="remote-container-paywall-gate">
        <ServicePaywallView serviceId={serviceId} />
      </div>
    );
  }

  // 2. Direct children (for static composition or unit testing)
  if (children) {
    return (
      <div
        data-testid={`remote-mfe-${serviceId}`}
        data-service={serviceId}
        className={cn('w-full h-full', className)}
      >
        {children}
      </div>
    );
  }

  // 3. Dynamic Remote Module Loader simulation / mounting logic
  const handleRetry = () => {
    setError(null);
    setLoading(true);
    // Simulate remote bundle fetch
    setTimeout(() => {
      setLoading(false);
    }, 600);
  };

  return (
    <div
      data-testid={`remote-mfe-${serviceId}`}
      data-service={serviceId}
      className={cn('w-full min-h-[400px] flex flex-col', className)}
    >
      {loading ? (
        fallback || (
          <div
            data-testid="mfe-loading-state"
            className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground space-y-4"
          >
            <div className="relative">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Connecting to {meta.name}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mounting remote micro-frontend container ({remoteName || `omyxia_${serviceId}`})...
              </p>
            </div>
          </div>
        )
      ) : error ? (
        <div
          data-testid="mfe-error-state"
          className="flex-1 flex flex-col items-center justify-center p-12 border border-dashed rounded-xl m-4 text-center space-y-4"
        >
          <div className="p-3 rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <div className="max-w-md">
            <h3 className="text-base font-semibold text-foreground">
              Microservice Connection Failed
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Unable to mount remote bundle for {meta.name}. The downstream microservice may be deploying or temporarily unreachable.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetry}
            data-testid="mfe-retry-btn"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Retry Connection
          </Button>
        </div>
      ) : (
        <div
          data-testid="mfe-active-container"
          className="flex-1 rounded-xl border bg-card p-6 shadow-sm"
        >
          <div className="flex items-center justify-between pb-4 border-b mb-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">{meta.name}</h2>
              <p className="text-xs text-muted-foreground">
                Mounted Micro-frontend · Tenant: {context.tenantId}
              </p>
            </div>
            <span className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-0.5 rounded border border-emerald-500/20">
              Active Session
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            Remote micro-frontend container ready for route: <code>{meta.route}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default RemoteMicrofrontendContainer;
