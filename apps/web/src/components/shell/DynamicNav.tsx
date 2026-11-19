'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Users,
  Briefcase,
  Layers,
  Boxes,
  BarChart3,
  ShieldCheck,
  LayoutGrid,
  Lock,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import {
  PORTAL_NAVIGATION_SERVICES,
  type MicroserviceMeta,
} from './microservices-registry';
import { usePortalEntitlements } from './PortalEntitlementsContext';
import { cn } from '@/lib/utils';
import type { MicroserviceId } from '@omyxia/shared-types';

const ICON_MAP = {
  Building2,
  Users,
  Briefcase,
  Layers,
  Boxes,
  BarChart3,
  ShieldCheck,
  LayoutGrid,
};

export interface DynamicNavProps {
  className?: string;
  onItemClick?: (serviceId: MicroserviceId) => void;
  filterEntitledOnly?: boolean;
}

export function DynamicNav({
  className,
  onItemClick,
  filterEntitledOnly = false,
}: DynamicNavProps) {
  const pathname = usePathname() || '';
  const { checkAccess, openPaywall, context } = usePortalEntitlements();

  const services = React.useMemo(() => {
    if (!filterEntitledOnly) return PORTAL_NAVIGATION_SERVICES;
    return PORTAL_NAVIGATION_SERVICES.filter((svc) => checkAccess(svc.id).allowed);
  }, [filterEntitledOnly, checkAccess]);

  const currentPlan = context.planTier || 'STARTER';

  return (
    <nav
      aria-label="Portal Microservices"
      data-testid="dynamic-nav"
      className={cn('flex flex-col h-full justify-between', className)}
    >
      <div className="space-y-4">
        {/* Section Header */}
        <div className="px-3 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            Microservices & Modules
          </p>
        </div>

        {/* Navigation Items List */}
        <ul className="space-y-1 px-2" data-testid="nav-service-list">
          {services.map((svc: MicroserviceMeta) => {
            const decision = checkAccess(svc.id);
            const isEntitled = decision.allowed;
            const IconComponent = ICON_MAP[svc.iconName] || Building2;
            const isActive = pathname === svc.route || (svc.route !== '/' && pathname.startsWith(svc.route));

            return (
              <li key={svc.id}>
                {isEntitled ? (
                  <Link
                    href={svc.route}
                    data-testid={`nav-item-${svc.id}`}
                    onClick={() => onItemClick?.(svc.id)}
                    className={cn(
                      'group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <IconComponent
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                      />
                      <span className="truncate">{svc.name}</span>
                    </div>

                    {svc.badge && svc.badge !== 'Included' && (
                      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                        {svc.badge}
                      </span>
                    )}
                  </Link>
                ) : (
                  <button
                    type="button"
                    data-testid={`nav-item-${svc.id}-locked`}
                    onClick={(e) => {
                      e.preventDefault();
                      openPaywall(svc.id, decision);
                      onItemClick?.(svc.id);
                    }}
                    className={cn(
                      'group w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      'text-muted-foreground/70 hover:bg-muted/80 hover:text-foreground text-left cursor-pointer'
                    )}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className="relative">
                        <IconComponent className="h-4 w-4 shrink-0 opacity-50" />
                        <Lock className="h-2.5 w-2.5 text-amber-500 absolute -bottom-1 -right-1" />
                      </div>
                      <span className="truncate">{svc.name}</span>
                    </div>

                    <span
                      data-testid={`badge-locked-${svc.id}`}
                      className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20"
                    >
                      <Lock className="h-2.5 w-2.5" />
                      {svc.badge || svc.minPlanTier}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Plan Status Card at Bottom of Nav */}
      <div className="p-3 border-t bg-muted/30 m-2 rounded-xl" data-testid="nav-plan-summary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
              {currentPlan} PLAN
            </span>
          </div>
          <Link
            href="/admin/plans"
            className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-0.5"
            data-testid="nav-upgrade-link"
          >
            <span>Upgrade</span>
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {context.isSuspended
            ? 'Account suspended — reactivate billing to restore access.'
            : 'Access enterprise ERP, WMS & AI by upgrading tier.'}
        </p>
      </div>
    </nav>
  );
}

export default DynamicNav;
