// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddOnEditorDialog } from './AddOnEditorDialog';
import type { AdminAddOn } from '@omyxia/shared-types';

const CRM_ADDON: AdminAddOn = {
  id: 'ao_crm',
  name: 'CRM',
  slug: 'addon.crm',
  priceCents: 5000,
  priceDollars: '50.00',
  description: 'Test CRM',
  appliesTo: 'ALL',
  isActive: true,
  planCount: 2,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

afterEach(() => cleanup());

describe('AddOnEditorDialog', () => {
  it('renders create mode with empty fields', () => {
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        onSubmit={async () => undefined}
      />
    );
    expect(screen.getByTestId('addon-editor-name')).toHaveValue('');
    // Number inputs canonicalise to "0" or "0.00" depending on browser.
    const price = screen.getByTestId('addon-editor-price');
    expect(['0', '0.00']).toContain((price as HTMLInputElement).value);
  });

  it('renders edit mode by populating from the add-on', () => {
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        addOn={CRM_ADDON}
        onSubmit={async () => undefined}
      />
    );
    expect(screen.getByTestId('addon-editor-name')).toHaveValue('CRM');
    expect(screen.getByTestId('addon-editor-slug')).toHaveValue('addon.crm');
    // Number inputs strip trailing zeros on some platforms — both are valid.
    const price = screen.getByTestId('addon-editor-price');
    expect(['50', '50.00']).toContain((price as HTMLInputElement).value);
    expect(screen.getByTestId('addon-editor-applies')).toHaveValue('ALL');
  });

  it('derives slug from name when slug field is empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />
    );
    await user.type(screen.getByTestId('addon-editor-name'), 'Quality Assurance');
    expect(screen.getByTestId('addon-editor-slug-preview')).toHaveTextContent(
      'addon.quality_assurance'
    );
    await user.click(screen.getByTestId('addon-editor-save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const arg = onSubmit.mock.calls[0]?.[0];
    if ('id' in arg!) throw new Error('expected create, got edit');
    expect(arg.slug).toBe('addon.quality_assurance');
    expect(arg.name).toBe('Quality Assurance');
  });

  it('blocks save when slug is invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />
    );
    await user.type(screen.getByTestId('addon-editor-name'), 'X');
    // Capital letters make the slug invalid.
    await user.type(screen.getByTestId('addon-editor-slug'), 'NotLower');
    // The slug-preview area shows the invalid-suffix marker.
    expect(screen.getByTestId('addon-editor-slug-preview').textContent).toMatch(
      /invalid/i
    );
    // The save button is disabled while slug is invalid.
    expect(
      (screen.getByTestId('addon-editor-save') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves an edit with a partial patch', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        addOn={CRM_ADDON}
        onSubmit={onSubmit}
      />
    );
    await user.clear(screen.getByTestId('addon-editor-price'));
    await user.type(screen.getByTestId('addon-editor-price'), '75.00');
    await user.click(screen.getByTestId('addon-editor-save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const arg = onSubmit.mock.calls[0]?.[0];
    if (!('id' in arg!)) throw new Error('expected edit');
    expect(arg.id).toBe('ao_crm');
    expect(arg.dto.priceCents).toBe(7500);
  });

  it('exposes a danger zone in edit mode', () => {
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        addOn={CRM_ADDON}
        onSubmit={async () => undefined}
        onDelete={async () => undefined}
      />
    );
    expect(screen.getByTestId('addon-editor-start-delete')).toBeInTheDocument();
  });

  it('confirms before deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => undefined);
    render(
      <AddOnEditorDialog
        open
        onOpenChange={() => undefined}
        addOn={CRM_ADDON}
        onSubmit={async () => undefined}
        onDelete={onDelete}
      />
    );
    await user.click(screen.getByTestId('addon-editor-start-delete'));
    expect(screen.getByTestId('addon-editor-cancel-delete')).toBeInTheDocument();
    await user.click(screen.getByTestId('addon-editor-confirm-delete'));
    expect(onDelete).toHaveBeenCalledWith('ao_crm');
  });
});
