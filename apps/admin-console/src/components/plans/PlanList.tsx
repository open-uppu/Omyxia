'use client';

/**
 * PlanList — table view for the plans catalog (P2.5).
 *
 * Columns:
 *   - Tier badge + name
 *   - Price (formatted from cents; "—" when $0)
 *   - # features enabled
 *   - Bundled add-ons (chips)
 *   - Tenants assigned
 *   - Status (active/inactive dot)
 *   - Actions: Edit
 *
 * Empty state: a single CTA "Create plan". Loading state: skeletons
 * in place of every row (8 rows).
 */

import * as React from 'react';
import { Edit3, Plus, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AdminPlan } from '@omyxia/shared-types';
import { formatPriceCents } from '@omyxia/shared-types';

export interface PlanListProps {
  plans: readonly AdminPlan[];
  loading?: boolean;
  onEdit: (plan: AdminPlan) => void;
  onCreate: () => void;
  /** Test id prefix. */
  testIdPrefix?: string;
}

export function PlanList({
  plans,
  loading = false,
  onEdit,
  onCreate,
  testIdPrefix = 'plan-list',
}: PlanListProps) {
  if (loading && plans.length === 0) {
    return (
      <div
        className="space-y-2"
        data-testid={`${testIdPrefix}-loading`}
        aria-busy="true"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md bg-muted"
            data-testid={`${testIdPrefix}-loading-row-${i}`}
          />
        ))}
      </div>
    );
  }
  if (plans.length === 0) {
    return (
      <Card className="border-dashed" data-testid={`${testIdPrefix}-empty`}>
        <div className="flex flex-col items-center gap-3 p-12 text-center">
          <Tag className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">No plans yet</p>
            <p className="text-xs text-muted-foreground">
              Create your first subscription tier to get started.
            </p>
          </div>
          <Button
            variant="default"
            onClick={onCreate}
            data-testid={`${testIdPrefix}-empty-cta`}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Create plan
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border" data-testid={`${testIdPrefix}`}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left">Plan</th>
            <th className="px-4 py-2 text-right">Price</th>
            <th className="px-4 py-2 text-right">Features</th>
            <th className="px-4 py-2 text-left">Add-ons</th>
            <th className="px-4 py-2 text-right">Tenants</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {plans.map((plan) => {
            const featuresEnabled = plan.features.filter((f) => f.enabled).length;
            return (
              <tr
                key={plan.id}
                data-testid={`${testIdPrefix}-row-${plan.id}`}
                data-tier={plan.tier}
                className="bg-background"
              >
                <td className="px-4 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{plan.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {plan.tier}
                    </span>
                  </div>
                </td>
                <td
                  className="px-4 py-2 text-right tabular-nums"
                  data-testid={`${testIdPrefix}-row-${plan.id}-price`}
                >
                  {plan.priceCents === 0 ? 'Free' : `${formatPriceCents(plan.priceCents)}/mo`}
                </td>
                <td
                  className="px-4 py-2 text-right tabular-nums"
                  data-testid={`${testIdPrefix}-row-${plan.id}-features`}
                >
                  {featuresEnabled}/{plan.features.length}
                </td>
                <td className="px-4 py-2">
                  {plan.addOnSlugs.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {plan.addOnSlugs.slice(0, 3).map((slug) => (
                        <Badge key={slug} variant="secondary" className="text-[10px]">
                          {slug.replace(/^addon\./, '')}
                        </Badge>
                      ))}
                      {plan.addOnSlugs.length > 3 ? (
                        <span className="text-xs text-muted-foreground">
                          +{plan.addOnSlugs.length - 3}
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td
                  className="px-4 py-2 text-right tabular-nums"
                  data-testid={`${testIdPrefix}-row-${plan.id}-tenants`}
                >
                  {plan.entitlementCount}
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={
                        plan.isActive
                          ? 'h-2 w-2 rounded-full bg-emerald-500'
                          : 'h-2 w-2 rounded-full bg-muted-foreground'
                      }
                    />
                    <span className="text-xs">
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(plan)}
                    data-testid={`${testIdPrefix}-row-${plan.id}-edit`}
                  >
                    <Edit3 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Edit
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
