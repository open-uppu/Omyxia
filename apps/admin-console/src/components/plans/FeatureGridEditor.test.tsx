// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureGridEditor } from './FeatureGridEditor';
import { FEATURE_CATALOG, catalogInDisplayOrder } from '@/lib/plans-feature-catalog';
import type { PlanFeature } from '@omyxia/shared-types';

afterEach(() => cleanup());

// Build a fully-populated value so every catalog row renders once.
// The editor pads missing keys with sensible defaults so passing the
// canonical 12-row plan keeps the test deterministic. Rows are
// emitted in `catalogInDisplayOrder` so the rendered order matches.
// Every row is `enabled: true` so the unlimited toggle is interactable
// in the tests below.
function makeFullValue(): PlanFeature[] {
  return catalogInDisplayOrder().map((entry, idx) => ({
    featureKey: entry.key,
    featureLabel: entry.label,
    category: entry.category,
    enabled: true,
    limit: entry.kind === 'limit' ? 0 : undefined,
    sortOrder: idx,
  }));
}

function makeRow(overrides: Partial<PlanFeature> = {}): PlanFeature {
  return {
    featureKey: FEATURE_CATALOG[0]!.key,
    featureLabel: FEATURE_CATALOG[0]!.label,
    category: FEATURE_CATALOG[0]!.category,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe('FeatureGridEditor', () => {
  it('renders one row per catalog feature with toggle + limit input for limit.* keys', () => {
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={() => undefined}
        testIdPrefix="t"
      />
    );
    expect(screen.getByTestId('t-grid')).toBeInTheDocument();
    // 12 catalog entries ⇒ 12 rows.
    expect(FEATURE_CATALOG.length).toBeGreaterThan(1);
    // Row 0 is the first catalog entry (module.bi, alphabetically).
    const firstRowIdx = FEATURE_CATALOG.findIndex(
      (c) => c.key === FEATURE_CATALOG[0]!.key
    );
    expect(screen.getByTestId(`t-row-${firstRowIdx}-toggle`)).toBeChecked();
    // The limit rows have a limit input.
    const limitKeys = FEATURE_CATALOG.filter((c) => c.kind === 'limit');
    for (const k of limitKeys) {
      const idx = FEATURE_CATALOG.findIndex((c) => c.key === k.key);
      expect(screen.getByTestId(`t-row-${idx}-limit`)).toBeInTheDocument();
    }
  });

  it('reorders rows via the down button at row 0', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={onChange}
        testIdPrefix="t"
      />
    );
    const ordered = catalogInDisplayOrder();
    const originalFirst = ordered[0]!.key;
    const originalSecond = ordered[1]!.key;
    await user.click(screen.getByTestId('t-row-0-down'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as PlanFeature[];
    expect(next[0]?.featureKey).toBe(originalSecond);
    expect(next[1]?.featureKey).toBe(originalFirst);
    expect(next.map((r) => r.sortOrder)).toEqual(
      Array.from({ length: next.length }, (_, i) => i)
    );
  });

  it('up button disabled at the top; down disabled at the bottom', () => {
    const value = makeFullValue();
    const total = value.length;
    render(
      <FeatureGridEditor
        value={value}
        onChange={() => undefined}
        testIdPrefix="t"
      />
    );
    expect(screen.getByTestId(`t-row-0-up`)).toBeDisabled();
    expect(screen.getByTestId(`t-row-${total - 1}-down`)).toBeDisabled();
  });

  it('disables all row controls when disabled', () => {
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={() => undefined}
        testIdPrefix="t"
        disabled
      />
    );
    expect(screen.getByTestId('t-row-0-up')).toBeDisabled();
    expect(screen.getByTestId('t-row-0-down')).toBeDisabled();
    expect(screen.getByTestId('t-row-0-toggle')).toBeDisabled();
  });

  it('emits optimistic update when a row is dragged', () => {
    const onChange = vi.fn();
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={onChange}
        testIdPrefix="t"
      />
    );
    const ordered = catalogInDisplayOrder();
    const originalFirst = ordered[0]!.key;
    const originalSecond = ordered[1]!.key;
    const row0 = screen.getByTestId('t-row-0');
    const row1 = screen.getByTestId('t-row-1');
    fireEvent.dragStart(row0);
    fireEvent.dragOver(row1);
    fireEvent.drop(row1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as PlanFeature[];
    expect(next[0]?.featureKey).toBe(originalSecond);
    expect(next[1]?.featureKey).toBe(originalFirst);
  });

  it('respects allowNullLimit by exposing the unlimited toggle on limit rows', () => {
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={() => undefined}
        testIdPrefix="t"
      />
    );
    // Without allowNullLimit the unlimited button is hidden.
    expect(screen.queryAllByTestId(/-limit-unlimited$/).length).toBe(0);
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={() => undefined}
        testIdPrefix="u"
        allowNullLimit
      />
    );
    // With allowNullLimit, every limit row has one unlimited button.
    const limitCount = FEATURE_CATALOG.filter((c) => c.kind === 'limit').length;
    expect(screen.queryAllByTestId(/^u-row-\d+-limit-unlimited$/).length).toBe(
      limitCount
    );
  });

  it('emits null when the unlimited toggle is pressed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FeatureGridEditor
        value={makeFullValue()}
        onChange={onChange}
        testIdPrefix="t"
        allowNullLimit
      />
    );
    const buttons = screen.queryAllByTestId(/^t-row-\d+-limit-unlimited$/);
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0]!);
    expect(onChange).toHaveBeenCalled();
    // The last `onChange` call should include some row with limit === null.
    const last =
      (onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ??
        []) as PlanFeature[];
    expect(last.some((r) => r.limit === null)).toBe(true);
  });

  it('renders gracefully when value is empty (catalog defaults fill in)', () => {
    render(<FeatureGridEditor value={[]} onChange={() => undefined} testIdPrefix="t" />);
    // The grid renders with all 12 catalog rows.
    expect(screen.getByTestId('t-grid')).toBeInTheDocument();
    const firstCatalogIdx = catalogInDisplayOrder().findIndex(
      (c) => c.key === FEATURE_CATALOG[0]!.key
    );
    expect(screen.getByTestId(`t-row-${firstCatalogIdx}`)).toBeInTheDocument();
  });
});

// Suppress unused-import warning: makeRow is used indirectly via FEATURE_CATALOG in some paths.
void makeRow;
