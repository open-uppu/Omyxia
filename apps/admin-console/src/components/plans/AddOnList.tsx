'use client';

/**
 * AddOnList — table view for the add-ons catalog (P2.5).
 *
 * Columns:
 *   - Name + slug
 *   - Price
 *   - Applies-to badge
 *   - Bundled in N plans
 *   - Status
 *   - Actions: Edit
 *
 * Same empty / loading pattern as `PlanList`.
 */

import * as React from 'react';
import { Edit3, Plus, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AdminAddOn } from '@omyxia/shared-types';
import { formatPriceCents } from '@omyxia/shared-types';

export interface AddOnListProps {
  addOns: readonly AdminAddOn[];
  loading?: boolean;
  onEdit: (addOn: AdminAddOn) => void;
  onCreate: () => void;
  testIdPrefix?: string;
}

const APPLIES_LABEL: Record<AdminAddOn['appliesTo'], string> = {
  ALL: 'All plans',
  FREE: 'Free',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

export function AddOnList({
  addOns,
  loading = false,
  onEdit,
  onCreate,
  testIdPrefix = 'addon-list',
}: AddOnListProps) {
  if (loading && addOns.length === 0) {
    return (
      <div
        className="space-y-2"
        data-testid={`${testIdPrefix}-loading`}
        aria-busy="true"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md bg-muted"
            data-testid={`${testIdPrefix}-loading-row-${i}`}
          />
        ))}
      </div>
    );
  }
  if (addOns.length === 0) {
    return (
      <Card className="border-dashed" data-testid={`${testIdPrefix}-empty`}>
        <div className="flex flex-col items-center gap-3 p-12 text-center">
          <Tag className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">No add-ons yet</p>
            <p className="text-xs text-muted-foreground">
              Add a module that augments a base plan — CRM, ERP, WMS, BI, MAS, etc.
            </p>
          </div>
          <Button
            variant="default"
            onClick={onCreate}
            data-testid={`${testIdPrefix}-empty-cta`}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Create add-on
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
            <th className="px-4 py-2 text-left">Add-on</th>
            <th className="px-4 py-2 text-right">Price</th>
            <th className="px-4 py-2 text-left">Applies to</th>
            <th className="px-4 py-2 text-right">Plans</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {addOns.map((addOn) => (
            <tr
              key={addOn.id}
              data-testid={`${testIdPrefix}-row-${addOn.id}`}
              data-applies={addOn.appliesTo}
              className="bg-background"
            >
              <td className="px-4 py-2">
                <div className="flex flex-col">
                  <span className="font-medium">{addOn.name}</span>
                  <code className="text-[10px] text-muted-foreground">
                    {addOn.slug}
                  </code>
                </div>
              </td>
              <td
                className="px-4 py-2 text-right tabular-nums"
                data-testid={`${testIdPrefix}-row-${addOn.id}-price`}
              >
                {addOn.priceCents === 0
                  ? 'Free'
                  : `${formatPriceCents(addOn.priceCents)}/mo`}
              </td>
              <td className="px-4 py-2">
                <Badge variant="outline" className="text-[10px]">
                  {APPLIES_LABEL[addOn.appliesTo]}
                </Badge>
              </td>
              <td
                className="px-4 py-2 text-right tabular-nums"
                data-testid={`${testIdPrefix}-row-${addOn.id}-plans`}
              >
                {addOn.planCount}
              </td>
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={
                      addOn.isActive
                        ? 'h-2 w-2 rounded-full bg-emerald-500'
                        : 'h-2 w-2 rounded-full bg-muted-foreground'
                    }
                  />
                  <span className="text-xs">
                    {addOn.isActive ? 'Active' : 'Inactive'}
                  </span>
                </span>
              </td>
              <td className="px-4 py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(addOn)}
                  data-testid={`${testIdPrefix}-row-${addOn.id}-edit`}
                >
                  <Edit3 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
