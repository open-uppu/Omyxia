'use client';

/**
 * FeatureGridEditor — toggle grid + limit input + drag-drop reorder
 * (P2.5).
 *
 * Renders one row per known feature key from the catalog. Each row
 * has a checkbox + (when the key is a `limit.*` row) a numeric input
 * for the cap. The grid supports drag-drop reordering using the
 * native HTML5 DnD API (no library dependency).
 *
 * Mouse-only drag-drop is exposed via the grab-handle on the left of
 * each row. Keyboard reordering is exposed via the ↑/↓ buttons next
 * to the handle (so it works without DnD support at all — covered
 * for accessibility).
 *
 * State flow:
 *   - `value` is the current `PlanFeature[]` (parent-controlled).
 *   - Drag handlers mutate `value` via `onChange` (cloned + sorted).
 *   - Reordering is FLUID (no save click); parents commit on save.
 *
 * `parentAllowedNullLimit: true` is the visual signal that the row's
 * limit input may be left empty (→ null = unlimited). Only ENTERPRISE
 * and LEGACY_FULL_ACCESS pass that flag; lower tiers cap.
 */

import * as React from 'react';
import { ArrowDown, ArrowUp, GripVertical, Infinity as InfinityIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  FEATURE_CATALOG,
  catalogKeyLookup,
  catalogInDisplayOrder,
  type FeatureCatalogEntry,
} from '@/lib/plans-feature-catalog';
import type { PlanFeature } from '@omyxia/shared-types';

export interface FeatureGridEditorProps {
  value: readonly PlanFeature[];
  onChange: (next: PlanFeature[]) => void;
  /** Whether the limit input may accept "Unlimited" (`null`). */
  allowNullLimit?: boolean;
  /** Disabled state (saving). */
  disabled?: boolean;
  /** Test id prefix. */
  testIdPrefix?: string;
}

type DragState = {
  fromIndex: number;
  overIndex: number | null;
} | null;

export function FeatureGridEditor({
  value,
  onChange,
  allowNullLimit = false,
  disabled = false,
  testIdPrefix = 'features',
}: FeatureGridEditorProps) {
  // Merge the catalog (canonical order) with the parent's edited rows.
  // Unknown rows (anything not in the catalog) are appended at the end
  // so the editor never silently drops a custom key the BE knows about.
  const rows = React.useMemo(() => mergeRowsWithCatalog(value), [value]);
  const lookup = React.useMemo(() => catalogKeyLookup(), []);
  const [drag, setDrag] = React.useState<DragState>(null);

  function moveRow(from: number, to: number): void {
    if (from === to) return;
    if (from < 0 || from >= rows.length) return;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(resequence(next));
  }

  function patchFeature(
    featureKey: string,
    patch: Partial<Pick<PlanFeature, 'enabled' | 'limit'>>
  ): void {
    onChange(
      rows.map((row) =>
        row.featureKey === featureKey
          ? {
              ...row,
              ...patch,
            }
          : row
      )
    );
  }

  return (
    <div className="space-y-1.5" data-testid={`${testIdPrefix}-grid`}>
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-b pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span aria-hidden />
        <span>Feature</span>
        <span className="text-right">Enabled</span>
        <span className="w-32 text-right">Limit</span>
      </div>
      {rows.map((row, idx) => {
        const catalog = lookup.get(row.featureKey) ?? inferCatalog(row);
        return (
          <FeatureRowEditor
            key={row.featureKey}
            row={row}
            catalog={catalog}
            index={idx}
            lastIndex={rows.length - 1}
            drag={drag}
            disabled={disabled}
            allowNullLimit={allowNullLimit}
            testIdPrefix={testIdPrefix}
            onToggleEnabled={(v) => patchFeature(row.featureKey, { enabled: v })}
            onChangeLimit={(v) => patchFeature(row.featureKey, { limit: v })}
            onMoveUp={() => moveRow(idx, idx - 1)}
            onMoveDown={() => moveRow(idx, idx + 1)}
            onDragStart={() => setDrag({ fromIndex: idx, overIndex: idx })}
            onDragOver={(e) => {
              e.preventDefault();
              if (!drag || drag.fromIndex === idx) return;
              setDrag({ ...drag, overIndex: idx });
            }}
            onDragLeave={() => {
              if (drag && drag.overIndex === idx) {
                setDrag({ ...drag, overIndex: null });
              }
            }}
            onDrop={() => {
              if (!drag || drag.overIndex == null) return;
              moveRow(drag.fromIndex, drag.overIndex);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
          />
        );
      })}
      {rows.length === 0 ? (
        <p
          className="rounded-md border border-dashed py-4 text-center text-sm text-muted-foreground"
          data-testid={`${testIdPrefix}-empty`}
        >
          No features toggled yet — pick a starting set in the catalog.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent
// ---------------------------------------------------------------------------

interface FeatureRowEditorProps {
  row: PlanFeature;
  catalog: FeatureCatalogEntry;
  index: number;
  lastIndex: number;
  drag: DragState;
  disabled: boolean;
  allowNullLimit: boolean;
  testIdPrefix: string;
  onToggleEnabled: (next: boolean) => void;
  onChangeLimit: (next: number | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function FeatureRowEditor({
  row,
  catalog,
  index,
  lastIndex,
  drag,
  disabled,
  allowNullLimit,
  testIdPrefix,
  onToggleEnabled,
  onChangeLimit,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: FeatureRowEditorProps) {
  const isDragSource = drag?.fromIndex === index;
  const isDragOver = drag?.overIndex === index && drag?.fromIndex !== index;
  const isLimitRow = catalog.kind === 'limit';
  const testId = `${testIdPrefix}-row-${index}`;
  return (
    <div
      role="row"
      data-testid={testId}
      data-feature-key={row.featureKey}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
        isDragSource && 'opacity-50',
        isDragOver && 'border-primary bg-primary/5',
        !isDragSource && !isDragOver && 'border-transparent hover:border-input'
      )}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`Move ${row.featureLabel} up`}
          disabled={disabled || index === 0}
          onClick={onMoveUp}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          data-testid={`${testId}-up`}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Move ${row.featureLabel} down`}
          disabled={disabled || index === lastIndex}
          onClick={onMoveDown}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          data-testid={`${testId}-down`}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span
          className="cursor-grab text-muted-foreground"
          aria-hidden
          data-testid={`${testId}-grip`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-medium">{row.featureLabel}</span>
        <span className="text-xs text-muted-foreground">{catalog.description}</span>
      </div>
      <Checkbox
        checked={row.enabled}
        disabled={disabled}
        onChange={(e) => onToggleEnabled(e.currentTarget.checked)}
        aria-label={`Toggle ${row.featureLabel}`}
        data-testid={`${testId}-toggle`}
      />
      <div className="w-32 text-right">
        {isLimitRow ? (
          <LimitInput
            disabled={disabled || !row.enabled}
            allowNull={allowNullLimit}
            value={row.limit}
            onChange={onChangeLimit}
            testId={`${testId}-limit`}
          />
        ) : (
          <span className="text-xs text-muted-foreground" aria-hidden>—</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Limit input — supports integer + "Unlimited" sentinel.
// ---------------------------------------------------------------------------

interface LimitInputProps {
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  allowNull: boolean;
  disabled: boolean;
  testId: string;
}

function LimitInput({ value, onChange, allowNull, disabled, testId }: LimitInputProps) {
  const [localText, setLocalText] = React.useState(
    value == null ? '' : String(value)
  );
  const [unlimited, setUnlimited] = React.useState(value === null);

  // Re-sync when the parent resets the row.
  React.useEffect(() => {
    setLocalText(value == null ? '' : String(value));
    setUnlimited(value === null);
  }, [value]);

  function commit(next: string): void {
    if (next === '' && unlimited) {
      onChange(null);
      return;
    }
    const parsed = Number(next);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(Math.floor(parsed));
    }
  }

  return (
    <div className="flex items-center justify-end gap-1" data-testid={testId}>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={unlimited ? '' : localText}
        disabled={disabled || unlimited}
        onChange={(e) => {
          setLocalText(e.currentTarget.value);
          commit(e.currentTarget.value);
        }}
        className="h-8 w-20 text-right text-sm tabular-nums"
        aria-label="Limit value"
      />
      {allowNull ? (
        <button
          type="button"
          aria-label="Toggle unlimited"
          aria-pressed={unlimited}
          disabled={disabled}
          onClick={() => {
            const next = !unlimited;
            setUnlimited(next);
            onChange(next ? null : 0);
          }}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-foreground disabled:opacity-40',
            unlimited && 'border-primary bg-primary/10 text-primary'
          )}
          data-testid={`${testId}-unlimited`}
        >
          <InfinityIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row merge helper — keeps the canonical catalog order while pulling
// override values from the parent's PlanFeature[].
// ---------------------------------------------------------------------------

function mergeRowsWithCatalog(
  parentRows: readonly PlanFeature[]
): PlanFeature[] {
  const byKey = new Map(parentRows.map((r) => [r.featureKey, r]));
  const seen = new Set<string>();
  const result: PlanFeature[] = [];
  for (const cat of catalogInDisplayOrder()) {
    const existing = byKey.get(cat.key);
    if (existing) {
      seen.add(cat.key);
      result.push({
        ...existing,
        featureLabel: cat.label,
        category: cat.category,
      });
    } else {
      result.push({
        featureKey: cat.key,
        featureLabel: cat.label,
        category: cat.category,
        enabled: false,
        limit: cat.kind === 'limit' ? 0 : undefined,
        sortOrder: result.length,
      });
    }
  }
  // Append any custom keys the parent knows about but the catalog doesn't.
  let next = result.length;
  for (const [key, val] of byKey.entries()) {
    if (seen.has(key)) continue;
    result.push({ ...val, sortOrder: next++ });
  }
  return result;
}

function inferCatalog(row: PlanFeature): FeatureCatalogEntry {
  const syntheticCategory: FeatureCatalogEntry['category'] =
    row.featureKey.startsWith('limit.')
      ? 'limit'
      : row.featureKey.startsWith('admin.')
      ? 'admin'
      : 'module';
  const syntheticKind: FeatureCatalogEntry['kind'] =
    syntheticCategory === 'limit' ? 'limit' : 'module';
  return {
    key: row.featureKey,
    label: row.featureLabel,
    category: syntheticCategory,
    kind: syntheticKind,
    deletable: true,
    description: row.featureKey,
  };
}

function resequence(rows: PlanFeature[]): PlanFeature[] {
  return rows.map((row, idx) => ({ ...row, sortOrder: idx }));
}

// Suppress unused-import warning for FEATURE_CATALOG (referenced via catalogInDisplayOrder).
void FEATURE_CATALOG;
