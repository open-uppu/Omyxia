'use client';

import * as React from 'react';
import Link from 'next/link';
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
  ArrowRight,
  ArrowLeft,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MICROSERVICES_REGISTRY, type MicroserviceMeta } from './microservices-registry';
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

export interface ServicePaywallViewProps {
  serviceId: MicroserviceId;
  className?: string;
}

export function ServicePaywallView({ serviceId, className }: ServicePaywallViewProps) {
  const { context, checkAccess } = usePortalEntitlements();
  const meta: MicroserviceMeta = MICROSERVICES_REGISTRY[serviceId] || MICROSERVICES_REGISTRY.erp;
  const IconComponent = ICON_MAP[meta.iconName] || Building2;
  const decision = checkAccess(serviceId);

  const currentPlan = context.planTier || 'STARTER';
  const upgradeHref = decision.upgradeUrl || `/admin/plans?highlight=${meta.id}`;

  return (
    <div
      data-testid="service-paywall-view"
      className={cn(
        'min-h-[70vh] flex flex-col items-center justify-center p-4 sm:p-8',
        className
      )}
    >
      <div className="w-full max-w-3xl space-y-6">
        {/* Navigation Breadcrumb */}
        <div>
          <Link
            href="/dashboard"
            data-testid="paywall-back-link"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Portal Main Hub</span>
          </Link>
        </div>

        {/* Hero Card */}
        <div className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl border-border/80">
          <div className="h-2 w-full bg-gradient-to-r from-primary via-indigo-500 to-purple-600" />

          <div className="p-6 sm:p-10 space-y-8">
            {/* Service Title & Tier */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-6">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                  <IconComponent className="h-8 w-8" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      <Lock className="h-3 w-3" />
                      Plan Upgrade Required
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Tier: <strong>{meta.badge || meta.minPlanTier}</strong>
                    </span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mt-1">
                    {meta.name}
                  </h1>
                  <p className="text-sm text-muted-foreground">{meta.tagline}</p>
                </div>
              </div>

              <div className="sm:text-right">
                <div className="text-xs text-muted-foreground">Current Organization Tier</div>
                <div className="text-base font-bold text-foreground uppercase">{currentPlan}</div>
              </div>
            </div>

            {/* Description & Value Proposition */}
            <div className="rounded-xl bg-muted/50 p-5 border border-border/60 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>Enterprise Module Overview</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {meta.description}
              </p>
            </div>

            {/* Key Capabilities */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Included Capabilities & Modules
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {meta.capabilities.map((cap, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border bg-background/50 p-4 space-y-1 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 font-medium text-sm text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span>{cap.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      {cap.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA Box */}
            <div className="rounded-xl bg-gradient-to-br from-primary/5 via-indigo-50/50 to-purple-50/50 dark:from-primary/10 dark:via-background dark:to-background border border-primary/20 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-foreground">Ready to empower your business?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upgrade your subscription or request an add-on activation from your tenant administrator.
                </p>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button
                  asChild
                  variant="default"
                  data-testid="paywall-view-upgrade-btn"
                  className="w-full sm:w-auto bg-gradient-to-r from-primary to-indigo-600 hover:opacity-95 shadow-md shadow-primary/20"
                >
                  <a href={upgradeHref} className="inline-flex items-center gap-2">
                    <span>Upgrade to {meta.badge || meta.minPlanTier}</span>
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ServicePaywallView;
