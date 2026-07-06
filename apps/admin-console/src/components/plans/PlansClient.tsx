'use client';

/**
 * PlansClient — top-level interactive shell (P2.5).
 *
 * Owns:
 *   - Tabs (Plans / Add-ons).
 *   - The `usePlans` hook (data + mutations).
 *   - The Plan + AddOn editor dialogs.
 *   - The "new plan" / "new add-on" + "edit" buttons.
 *
 * This component is mounted from `apps/admin-console/src/app/(app)/plans/page.tsx`
 * inside the FeatureGuard. It's the only client island for the page.
 *
 * Tab state is persisted to localStorage so re-mounts / refreshes
 * don't reset the user's selection.
 */

import * as React from 'react';
import { useCallback, useState } from 'react';
import { Plus, RefreshCw, Tags } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AddOnEditorDialog } from '@/components/plans/AddOnEditorDialog';
import { AddOnList } from '@/components/plans/AddOnList';
import { PlanEditorDialog } from '@/components/plans/PlanEditorDialog';
import { PlanList } from '@/components/plans/PlanList';
import { usePlans } from '@/lib/use-plans';
import type {
  AdminPlan,
  AdminAddOn,
  CreatePlanDto,
  CreateAddOnDto,
  UpdatePlanDto,
  UpdateAddOnDto,
} from '@omyxia/shared-types';

type TabKey = 'plans' | 'addons';

const TAB_KEY = 'omyxia.admin.plans.tab';

function readPersistedTab(): TabKey {
  if (typeof window === 'undefined') return 'plans';
  try {
    const raw = window.localStorage.getItem(TAB_KEY);
    return raw === 'addons' ? 'addons' : 'plans';
  } catch {
    return 'plans';
  }
}

function persistTab(tab: TabKey): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* ignore quota errors */
  }
}

export interface PlansClientProps {
  /** Initial tab (overrides localStorage default for tests). */
  initialTab?: TabKey;
}

export function PlansClient({ initialTab }: PlansClientProps = {}) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? readPersistedTab());
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlan | undefined>();
  const [addOnDialogOpen, setAddOnDialogOpen] = useState(false);
  const [editingAddOn, setEditingAddOn] = useState<AdminAddOn | undefined>();
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingAddOn, setSavingAddOn] = useState(false);

  const {
    state,
    plans,
    addOns,
    refresh,
    createPlan,
    updatePlan,
    deletePlan,
    createAddOn,
    updateAddOn,
    deleteAddOn,
  } = usePlans();

  const loading = state.kind === 'loading' && plans.length === 0;
  const refreshing = state.kind === 'loading' && plans.length > 0;
  const error = state.kind === 'error' ? state.error : null;

  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    persistTab(next);
  }, []);

  function openCreatePlan(): void {
    setEditingPlan(undefined);
    setPlanDialogOpen(true);
  }

  function openEditPlan(plan: AdminPlan): void {
    setEditingPlan(plan);
    setPlanDialogOpen(true);
  }

  function openCreateAddOn(): void {
    setEditingAddOn(undefined);
    setAddOnDialogOpen(true);
  }

  function openEditAddOn(addOn: AdminAddOn): void {
    setEditingAddOn(addOn);
    setAddOnDialogOpen(true);
  }

  async function handlePlanSubmit(
    payload: CreatePlanDto | { id: string; dto: UpdatePlanDto }
  ): Promise<void> {
    setSavingPlan(true);
    try {
      if ('id' in payload) {
        await updatePlan(payload.id, payload.dto);
      } else {
        await createPlan(payload);
      }
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleAddOnSubmit(
    payload: CreateAddOnDto | { id: string; dto: UpdateAddOnDto }
  ): Promise<void> {
    setSavingAddOn(true);
    try {
      if ('id' in payload) {
        await updateAddOn(payload.id, payload.dto);
      } else {
        await createAddOn(payload);
      }
    } finally {
      setSavingAddOn(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="page-plans-client">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tags className="h-5 w-5" aria-hidden />
            Plans
          </h1>
          <p className="text-sm text-muted-foreground">
            Catalog of subscription tiers + per-tier feature toggles.
            Add-ons augment the base plan and are listed separately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">P2.5</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
            data-testid="plans-refresh"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          {tab === 'plans' ? (
            <Button
              variant="default"
              size="sm"
              onClick={openCreatePlan}
              data-testid="plans-new"
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              New plan
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={openCreateAddOn}
              data-testid="addons-new"
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              New add-on
            </Button>
          )}
        </div>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-destructive">
                Failed to load plans
              </p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              data-testid="plans-retry"
            >
              Retry
            </Button>
          </div>
        </Card>
      ) : null}

      <div
        className="inline-flex items-center rounded-md border bg-background p-1"
        role="tablist"
        aria-label="Plan management tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'plans'}
          onClick={() => switchTab('plans')}
          className={`rounded-sm px-3 py-1 text-sm transition-colors ${
            tab === 'plans'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          data-testid="plans-tab-plans"
        >
          Plans
          <span className="ml-1.5 text-xs opacity-70">{plans.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'addons'}
          onClick={() => switchTab('addons')}
          className={`rounded-sm px-3 py-1 text-sm transition-colors ${
            tab === 'addons'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          data-testid="plans-tab-addons"
        >
          Add-ons
          <span className="ml-1.5 text-xs opacity-70">{addOns.length}</span>
        </button>
      </div>

      <section
        role="tabpanel"
        aria-hidden={tab !== 'plans'}
        hidden={tab !== 'plans'}
        data-testid="plans-panel-plans"
      >
        <PlanList
          plans={plans}
          loading={loading}
          onEdit={openEditPlan}
          onCreate={openCreatePlan}
        />
      </section>

      <section
        role="tabpanel"
        aria-hidden={tab !== 'addons'}
        hidden={tab !== 'addons'}
        data-testid="plans-panel-addons"
      >
        <AddOnList
          addOns={addOns}
          loading={loading}
          onEdit={openEditAddOn}
          onCreate={openCreateAddOn}
        />
      </section>

      <PlanEditorDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        plan={editingPlan}
        addOns={addOns}
        onSubmit={handlePlanSubmit}
        onDelete={async (id) => {
          setSavingPlan(true);
          try {
            await deletePlan(id);
          } finally {
            setSavingPlan(false);
          }
        }}
        saving={savingPlan}
      />

      <AddOnEditorDialog
        open={addOnDialogOpen}
        onOpenChange={setAddOnDialogOpen}
        addOn={editingAddOn}
        onSubmit={handleAddOnSubmit}
        onDelete={async (id) => {
          setSavingAddOn(true);
          try {
            await deleteAddOn(id);
          } finally {
            setSavingAddOn(false);
          }
        }}
        saving={savingAddOn}
      />
    </div>
  );
}
