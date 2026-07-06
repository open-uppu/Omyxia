'use client';

/**
 * PlanEditorDialog — create / edit a plan (P2.5).
 *
 * Form fields:
 *   - Display name (required, ≤ 80 chars).
 *   - Tier (FREE / PRO / ENTERPRISE / LEGACY_FULL_ACCESS).
 *   - Price (USD dollars; converts to cents on submit).
 *   - Description (optional, ≤ 500 chars).
 *   - Active flag (toggle).
 *   - Bundled add-on slugs (multi-select).
 *   - Features (drag-drop reorderable toggle grid, with limit inputs).
 *
 * The form is fully controlled — the parent owns the in-flight state
 * so it can persist / re-render / swap children without losing edits.
 * The dialog itself is dumb: it opens / closes + forwards submissions.
 *
 * Why not use react-hook-form?
 *   - The form is short (under 10 fields), so uncontrolled <input>s
 *     with a single `useState` snapshot on submit keeps the tests
 *     deterministic (no field-level validation race).
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  AdminPlanTierSchema,
  type AdminPlan,
  type AdminAddOn,
  type AdminPlanTier,
  type AddOnSlug,
  type CreatePlanDto,
  type PlanFeature,
  type UpdatePlanDto,
  centsToDollars,
  dollarsToCents,
  formatPriceCents,
} from '@omyxia/shared-types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import {
  Dialog,
  DialogCloseButton,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { FeatureGridEditor } from '@/components/plans/FeatureGridEditor';

export interface PlanEditorDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Existing plan when editing; undefined when creating. */
  plan?: AdminPlan;
  /** All known add-ons (for the multi-select). */
  addOns: readonly AdminAddOn[];
  onSubmit: (dto: CreatePlanDto | { id: string; dto: UpdatePlanDto }) => Promise<void>;
  onDelete?: (planId: string) => Promise<void>;
  saving?: boolean;
}

interface FormState {
  name: string;
  tier: AdminPlanTier;
  priceDollars: string;
  description: string;
  isActive: boolean;
  addOnSlugs: AddOnSlug[];
  features: PlanFeature[];
}

const TIER_OPTIONS: AdminPlanTier[] = [
  'FREE',
  'PRO',
  'ENTERPRISE',
  'LEGACY_FULL_ACCESS',
];

function planToForm(plan: AdminPlan | undefined): FormState {
  return {
    name: plan?.name ?? '',
    tier: plan?.tier ?? 'PRO',
    priceDollars: plan == null ? '0.00' : centsToDollars(plan.priceCents).toFixed(2),
    description: plan?.description ?? '',
    isActive: plan?.isActive ?? true,
    addOnSlugs: [...(plan?.addOnSlugs ?? [])],
    features: plan?.features ? [...plan.features] : [],
  };
}

export function PlanEditorDialog({
  open,
  onOpenChange,
  plan,
  addOns,
  onSubmit,
  onDelete,
  saving = false,
}: PlanEditorDialogProps) {
  const [form, setForm] = useState<FormState>(() => planToForm(plan));
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset when the dialog opens with a new plan (or no plan = create).
  useEffect(() => {
    if (!open) return;
    setForm(planToForm(plan));
    setError(null);
    setConfirmingDelete(false);
  }, [open, plan]);

  const isEdit = Boolean(plan);
  const isUnlimitedTier =
    form.tier === 'ENTERPRISE' || form.tier === 'LEGACY_FULL_ACCESS';
  const priceCents = useMemo(() => {
    const parsed = Number(form.priceDollars);
    if (!Number.isFinite(parsed)) return 0;
    return dollarsToCents(parsed);
  }, [form.priceDollars]);

  const nameInvalid = !form.name.trim() || form.name.length > 80;
  const descriptionInvalid = form.description.length > 500;

  function toggleAddOn(slug: AddOnSlug): void {
    setForm((prev) => {
      const has = prev.addOnSlugs.includes(slug);
      return {
        ...prev,
        addOnSlugs: has
          ? prev.addOnSlugs.filter((s) => s !== slug)
          : [...prev.addOnSlugs, slug],
      };
    });
  }

  async function submit(): Promise<void> {
    setError(null);
    if (nameInvalid) {
      setError('Display name is required (≤ 80 chars).');
      return;
    }
    if (descriptionInvalid) {
      setError('Description must be ≤ 500 chars.');
      return;
    }
    if (priceCents < 0) {
      setError('Price must be ≥ $0.');
      return;
    }
    const tierParse = AdminPlanTierSchema.safeParse(form.tier);
    if (!tierParse.success) {
      setError('Pick a valid tier.');
      return;
    }
    try {
      const featuresDto = form.features.map((f) => ({
        ...f,
        // Strip optional fields not in the DTO.
        category: f.category,
        limit: f.limit === undefined ? undefined : f.limit,
      }));
      const dto: CreatePlanDto = {
        name: form.name.trim(),
        tier: form.tier,
        priceCents,
        description: form.description.trim() || null,
        isActive: form.isActive,
        sortOrder: plan?.sortOrder ?? 0,
        addOnSlugs: form.addOnSlugs,
        features: featuresDto,
      };
      if (plan) {
        await onSubmit({ id: plan.id, dto });
      } else {
        await onSubmit(dto);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function handleDelete(): Promise<void> {
    if (!plan || !onDelete) return;
    setError(null);
    try {
      await onDelete(plan.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} dismissible={!saving}>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit “${plan?.name}”` : 'Create plan'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update pricing, tier, add-ons, and feature toggles. Changes apply immediately.'
            : 'Define a new subscription tier. Tier is the canonical slug; pick carefully.'}
        </DialogDescription>
        <DialogCloseButton>×</DialogCloseButton>
      </DialogHeader>
      <DialogBody>
        {error ? (
          <div
            className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="plan-editor-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Display name *</Label>
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              invalid={nameInvalid && form.name.length > 0}
              placeholder="Pro"
              maxLength={80}
              data-testid="plan-editor-name"
            />
            <p className="text-xs text-muted-foreground">
              {form.name.length}/80 — used on invoices, dashboards, and the upgrade modal.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-tier">Tier *</Label>
            <Select
              id="plan-tier"
              value={form.tier}
              onChange={(e) =>
                setForm({ ...form, tier: e.currentTarget.value as AdminPlanTier })
              }
              data-testid="plan-editor-tier"
            >
              {TIER_OPTIONS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Determines routing rules (legacy = migration tier).
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan-price">Monthly price (USD)</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                id="plan-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={form.priceDollars}
                onChange={(e) =>
                  setForm({ ...form, priceDollars: e.currentTarget.value })
                }
                className="tabular-nums"
                data-testid="plan-editor-price"
              />
            </div>
            <p className="text-xs text-muted-foreground" data-testid="plan-editor-price-preview">
              Canonical: {formatPriceCents(priceCents)}/mo · {priceCents}¢
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Checkbox
              checked={form.isActive}
              onChange={(e) =>
                setForm({ ...form, isActive: e.currentTarget.checked })
              }
              label="Active"
              description="Inactive plans are hidden from new signups but keep existing tenants."
              data-testid="plan-editor-active"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="plan-description">Description</Label>
          <Textarea
            id="plan-description"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.currentTarget.value })
            }
            invalid={descriptionInvalid}
            placeholder="Email + Chat + HR for growing teams."
            maxLength={500}
            rows={3}
            data-testid="plan-editor-description"
          />
          <p className="text-xs text-muted-foreground">
            {form.description.length}/500
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Bundled add-ons</Label>
          <p className="text-xs text-muted-foreground">
            Picked add-ons are auto-included when a tenant is on this plan.
          </p>
          {addOns.length === 0 ? (
            <p
              className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground"
              data-testid="plan-editor-no-addons"
            >
              No add-ons catalogued yet — create some in the Add-ons tab.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="plan-editor-addons">
              {addOns.map((addon) => {
                const checked = form.addOnSlugs.includes(addon.slug);
                return (
                  <Checkbox
                    key={addon.slug}
                    checked={checked}
                    onChange={() => toggleAddOn(addon.slug)}
                    label={
                      <span className="flex items-center gap-2">
                        <span>{addon.name}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {formatPriceCents(addon.priceCents)}
                        </Badge>
                      </span>
                    }
                    description={
                      addon.description ||
                      `Applies to: ${addon.appliesTo}.`
                    }
                    data-testid={`plan-editor-addon-${addon.slug}`}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Feature toggles</Label>
            <span className="text-xs text-muted-foreground">
              Drag a row to reorder · {isUnlimitedTier ? 'Unlimited allowed' : 'Numeric cap only'}
            </span>
          </div>
          <FeatureGridEditor
            value={form.features}
            onChange={(features) => setForm({ ...form, features })}
            allowNullLimit={isUnlimitedTier}
            disabled={saving}
            testIdPrefix="plan-editor"
          />
        </div>

        {isEdit && onDelete && plan ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-destructive">Danger zone</p>
                <p className="text-xs text-muted-foreground">
                  Delete this plan. Existing tenants stay on the historical
                  entitlement — this only removes the plan from the catalog.
                </p>
              </div>
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={saving}
                    data-testid="plan-editor-cancel-delete"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={saving}
                    data-testid="plan-editor-confirm-delete"
                  >
                    Confirm delete
                  </Button>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                  data-testid="plan-editor-start-delete"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Delete plan
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={saving}
          data-testid="plan-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="default"
          onClick={submit}
          disabled={saving || nameInvalid}
          data-testid="plan-editor-save"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create plan'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
