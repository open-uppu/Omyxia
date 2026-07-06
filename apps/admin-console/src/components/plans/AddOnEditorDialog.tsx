'use client';

/**
 * AddOnEditorDialog — create / edit an add-on (P2.5).
 *
 * Form fields:
 *   - Name (required, ≤ 80 chars). Slug is derived when blank.
 *   - Slug (override; otherwise derived from the name).
 *   - Price (USD dollars; converts to cents on submit).
 *   - Applies-to (ALL / FREE / PRO / ENTERPRISE).
 *   - Description (optional, ≤ 500 chars).
 *   - Active toggle.
 *
 * Validation:
 *   - Slug is checked against `addon.<lowercase>` regex up-front so
 *     the user gets immediate feedback instead of a 400 on save.
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  type AdminAddOn,
  type AddOnAppliesTo,
  type AddOnSlug,
  type CreateAddOnDto,
  type UpdateAddOnDto,
  AddOnSlugSchema,
  centsToDollars,
  dollarsToCents,
  formatPriceCents,
} from '@omyxia/shared-types';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

export interface AddOnEditorDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  addOn?: AdminAddOn;
  onSubmit: (dto: CreateAddOnDto | { id: string; dto: UpdateAddOnDto }) => Promise<void>;
  onDelete?: (addOnId: string) => Promise<void>;
  saving?: boolean;
}

const APPLIES_OPTIONS: AddOnAppliesTo[] = ['ALL', 'FREE', 'PRO', 'ENTERPRISE'];

interface FormState {
  name: string;
  slug: string; // raw text — derived from name when blank
  priceDollars: string;
  appliesTo: AddOnAppliesTo;
  description: string;
  isActive: boolean;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

function addOnToForm(addOn: AdminAddOn | undefined): FormState {
  return {
    name: addOn?.name ?? '',
    slug: addOn?.slug ?? '',
    priceDollars:
      addOn == null ? '0.00' : centsToDollars(addOn.priceCents).toFixed(2),
    appliesTo: addOn?.appliesTo ?? 'ALL',
    description: addOn?.description ?? '',
    isActive: addOn?.isActive ?? true,
  };
}

export function AddOnEditorDialog({
  open,
  onOpenChange,
  addOn,
  onSubmit,
  onDelete,
  saving = false,
}: AddOnEditorDialogProps) {
  const [form, setForm] = useState<FormState>(() => addOnToForm(addOn));
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(addOnToForm(addOn));
    setError(null);
    setConfirmingDelete(false);
  }, [open, addOn]);

  const isEdit = Boolean(addOn);
  const resolvedSlug = useMemo(() => {
    const candidate = (form.slug || slugify(form.name)).trim();
    return `addon.${candidate.replace(/^addon\./, '')}`;
  }, [form.slug, form.name]);
  const slugValid = AddOnSlugSchema.safeParse(resolvedSlug).success;
  const nameInvalid = !form.name.trim() || form.name.length > 80;
  const descriptionInvalid = form.description.length > 500;
  const priceCents = useMemo(() => {
    const parsed = Number(form.priceDollars);
    if (!Number.isFinite(parsed)) return 0;
    return dollarsToCents(parsed);
  }, [form.priceDollars]);

  async function submit(): Promise<void> {
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (nameInvalid) {
      setError('Name must be ≤ 80 chars.');
      return;
    }
    if (descriptionInvalid) {
      setError('Description must be ≤ 500 chars.');
      return;
    }
    if (!slugValid) {
      setError('Slug must match addon.<lowercase> (letters/digits/_/-).');
      return;
    }
    try {
      const dto: CreateAddOnDto = {
        name: form.name.trim(),
        slug: resolvedSlug as AddOnSlug,
        priceCents,
        description: form.description.trim() || null,
        appliesTo: form.appliesTo,
        isActive: form.isActive,
      };
      if (addOn) {
        await onSubmit({ id: addOn.id, dto });
      } else {
        await onSubmit(dto);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function handleDelete(): Promise<void> {
    if (!addOn || !onDelete) return;
    setError(null);
    try {
      await onDelete(addOn.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} dismissible={!saving}>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit “${addOn?.name}”` : 'Create add-on'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update pricing, applicability, and description.'
            : 'Add a module add-on. Slug is derived from the name.'}
        </DialogDescription>
        <DialogCloseButton>×</DialogCloseButton>
      </DialogHeader>
      <DialogBody>
        {error ? (
          <div
            className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="addon-editor-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="addon-name">Name *</Label>
            <Input
              id="addon-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              placeholder="CRM"
              maxLength={80}
              invalid={nameInvalid && form.name.length > 0}
              data-testid="addon-editor-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addon-slug">Slug</Label>
            <Input
              id="addon-slug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.currentTarget.value })}
              placeholder={slugify(form.name) || 'auto-derived'}
              className="font-mono text-xs"
              data-testid="addon-editor-slug"
            />
            <p className="text-xs text-muted-foreground" data-testid="addon-editor-slug-preview">
              Resolves to <code className="rounded bg-muted px-1">{resolvedSlug}</code>
              {!slugValid ? ' · invalid' : ''}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="addon-price">Price (USD)</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                id="addon-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={form.priceDollars}
                onChange={(e) =>
                  setForm({ ...form, priceDollars: e.currentTarget.value })
                }
                className="tabular-nums"
                data-testid="addon-editor-price"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Canonical: {formatPriceCents(priceCents)}/mo
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addon-applies">Applies to</Label>
            <Select
              id="addon-applies"
              value={form.appliesTo}
              onChange={(e) =>
                setForm({
                  ...form,
                  appliesTo: e.currentTarget.value as AddOnAppliesTo,
                })
              }
              data-testid="addon-editor-applies"
            >
              {APPLIES_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Restricts which plans this add-on can be bundled onto.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="addon-description">Description</Label>
          <Textarea
            id="addon-description"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.currentTarget.value })
            }
            placeholder="Customer relationship module (leads, pipeline, contacts)."
            invalid={descriptionInvalid}
            maxLength={500}
            rows={3}
            data-testid="addon-editor-description"
          />
          <p className="text-xs text-muted-foreground">
            {form.description.length}/500
          </p>
        </div>

        <Checkbox
          checked={form.isActive}
          onChange={(e) =>
            setForm({ ...form, isActive: e.currentTarget.checked })
          }
          label="Active"
          description="Inactive add-ons are hidden from the editor picker."
          data-testid="addon-editor-active"
        />

        {isEdit && onDelete && addOn ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-destructive">Danger zone</p>
                <p className="text-xs text-muted-foreground">
                  Deleting removes the add-on from the catalog AND strips it
                  from every plan that currently bundles it. {addOn.planCount} plan
                  {addOn.planCount === 1 ? '' : 's'} reference
                  {addOn.planCount === 1 ? 's' : ''} this slug.
                </p>
              </div>
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={saving}
                    data-testid="addon-editor-cancel-delete"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={saving}
                    data-testid="addon-editor-confirm-delete"
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
                  data-testid="addon-editor-start-delete"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Delete add-on
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
          data-testid="addon-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="default"
          onClick={submit}
          disabled={saving || nameInvalid || !slugValid}
          data-testid="addon-editor-save"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create add-on'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
