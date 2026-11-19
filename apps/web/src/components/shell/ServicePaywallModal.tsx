'use client';

import * as React from 'react';
import { useEffect, useRef } from 'react';
import {
  Building2,
  Users,
  Briefcase,
  Layers,
  Boxes,
  BarChart3,
  ShieldCheck,
  LayoutGrid,
  X,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Lock,
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

export interface ServicePaywallModalProps {
  serviceId?: MicroserviceId | null;
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export function ServicePaywallModal({
  serviceId: propServiceId,
  isOpen: propIsOpen,
  onClose: propOnClose,
  className,
}: ServicePaywallModalProps) {
  const { activePaywall, closePaywall, context } = usePortalEntitlements();
  const modalRef = useRef<HTMLDivElement>(null);

  const isOpen = propIsOpen !== undefined ? propIsOpen : activePaywall.isOpen;
  const targetId = propServiceId || activePaywall.serviceId || 'erp';
  const handleClose = propOnClose || closePaywall;

  const meta: MicroserviceMeta = MICROSERVICES_REGISTRY[targetId] || MICROSERVICES_REGISTRY.erp;
  const IconComponent = ICON_MAP[meta.iconName] || Building2;
  const decision = activePaywall.decision;

  // Handle Escape key & outside click
  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const currentPlan = context.planTier || 'STARTER';
  const upgradeHref = decision?.upgradeUrl || `/admin/plans?highlight=${meta.id}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      data-testid="service-paywall-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        data-testid="paywall-modal-content"
        className={cn(
          'relative w-full max-w-xl overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl',
          'border-primary/20 dark:border-primary/30',
          className
        )}
      >
        {/* Top Decorative Header Accent */}
        <div className="h-2 w-full bg-gradient-to-r from-primary via-indigo-500 to-purple-600" />

        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          data-testid="paywall-close-btn"
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 sm:p-8 space-y-6">
          {/* Header Block */}
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
              <IconComponent className="h-7 w-7" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  data-testid="paywall-plan-badge"
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20"
                >
                  <Lock className="h-3 w-3" />
                  {meta.badge || meta.minPlanTier} Plan
                </span>
                <span className="text-xs text-muted-foreground">
                  Current: <strong className="uppercase">{currentPlan}</strong>
                </span>
              </div>

              <h2
                id="paywall-title"
                data-testid="paywall-service-name"
                className="text-2xl font-bold tracking-tight text-foreground"
              >
                {meta.name}
              </h2>
              <p className="text-sm text-muted-foreground">{meta.tagline}</p>
            </div>
          </div>

          {/* Value Prop Banner */}
          <div className="rounded-xl bg-muted/60 p-4 border border-border/60">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Unlock Advanced Enterprise Capabilities</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {meta.description}
            </p>
          </div>

          {/* Highlights Grid */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What you will unlock:
            </h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {meta.highlightFeatures.map((feat, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 rounded-lg bg-card p-2.5 border border-border/50 text-foreground"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  <span className="leading-snug">{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-end gap-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              data-testid="paywall-cancel-btn"
              className="w-full sm:w-auto"
            >
              Maybe Later
            </Button>

            <Button
              asChild
              variant="default"
              size="sm"
              data-testid="paywall-upgrade-cta"
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
  );
}

export default ServicePaywallModal;
