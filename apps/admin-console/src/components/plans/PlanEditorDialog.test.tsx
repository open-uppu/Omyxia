// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanEditorDialog } from './PlanEditorDialog';
import type { AdminPlan, AdminAddOn } from '@omyxia/shared-types';

const PRO_PLAN: AdminPlan = {
  id: 'p_pro',
  name: 'Pro',
  tier: 'PRO',
  priceCents: 9900,
  priceDollars: '99.00',
  description: 'Test plan',
  isActive: true,
  sortOrder: 1,
  addOnSlugs: [],
  features: [
    {
      featureKey: 'module.email',
      featureLabel: 'Email',
      category: 'module',
      enabled: true,
      sortOrder: 0,
    },
    {
      featureKey: 'module.hr',
      featureLabel: 'HR',
      category: 'module',
      enabled: false,
      sortOrder: 1,
    },
    {
      featureKey: 'limit.maxUsers',
      featureLabel: 'Max users',
      category: 'limit',
      enabled: true,
      limit: 25,
      sortOrder: 2,
    },
  ],
  entitlementCount: 47,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

const CRM_ADDON: AdminAddOn = {
  id: 'ao_crm',
  name: 'CRM',
  slug: 'addon.crm',
  priceCents: 5000,
  priceDollars: '50.00',
  description: 'CRM module',
  appliesTo: 'ALL',
  isActive: true,
  planCount: 2,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

afterEach(() => cleanup());

describe('PlanEditorDialog', () => {
  beforeEach(() => {
    // jsdom matchMedia is set up in vitest.setup.ts.
  });

  it('renders create mode by default with empty fields', () => {
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        addOns={[CRM_ADDON]}
        onSubmit={async () => undefined}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('plan-editor-name')).toHaveValue('');
    // Number inputs canonicalise to "0" or "0.00" depending on browser.
    const price = screen.getByTestId('plan-editor-price');
    expect(['0', '0.00']).toContain((price as HTMLInputElement).value);
  });

  it('renders edit mode by populating from the plan', () => {
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        plan={PRO_PLAN}
        addOns={[CRM_ADDON]}
        onSubmit={async () => undefined}
      />
    );
    expect(screen.getByTestId('plan-editor-name')).toHaveValue('Pro');
    // Number inputs canonicalise to either "99" or "99.00" depending
    // on the platform; both are valid for the price field.
    const price = screen.getByTestId('plan-editor-price');
    expect(['99', '99.00']).toContain((price as HTMLInputElement).value);
    expect(screen.getByTestId('plan-editor-tier')).toHaveValue('PRO');
    expect(screen.getByTestId('plan-editor-description')).toHaveValue('Test plan');
  });

  it('saves with the correct DTO for create mode', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        addOns={[CRM_ADDON]}
        onSubmit={onSubmit}
      />
    );
    await user.type(screen.getByTestId('plan-editor-name'), 'Starter');
    await user.clear(screen.getByTestId('plan-editor-price'));
    await user.type(screen.getByTestId('plan-editor-price'), '49.00');
    await user.click(screen.getByTestId('plan-editor-addon-addon.crm'));
    await user.click(screen.getByTestId('plan-editor-save'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const arg = onSubmit.mock.calls[0]?.[0] as Parameters<
      Parameters<typeof PlanEditorDialog>[0]['onSubmit']
    >[0];
    if ('id' in arg) throw new Error('expected create, got edit');
    expect(arg.name).toBe('Starter');
    expect(arg.tier).toBe('PRO');
    expect(arg.priceCents).toBe(4900);
    expect(arg.addOnSlugs).toEqual(['addon.crm']);
  });

  it('saves with the correct DTO for edit mode', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        plan={PRO_PLAN}
        addOns={[CRM_ADDON]}
        onSubmit={onSubmit}
      />
    );
    await user.clear(screen.getByTestId('plan-editor-price'));
    await user.type(screen.getByTestId('plan-editor-price'), '199.00');
    await user.click(screen.getByTestId('plan-editor-save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const arg = onSubmit.mock.calls[0]?.[0];
    if (!('id' in arg!)) throw new Error('expected edit, got create');
    expect(arg.id).toBe('p_pro');
    expect(arg.dto.priceCents).toBe(19900);
  });

  it('blocks save when name is empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        addOns={[]}
        onSubmit={onSubmit}
      />
    );
    await user.click(screen.getByTestId('plan-editor-save'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a danger zone for edit when onDelete is provided', () => {
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        plan={PRO_PLAN}
        addOns={[]}
        onSubmit={async () => undefined}
        onDelete={async () => undefined}
      />
    );
    expect(screen.getByTestId('plan-editor-start-delete')).toBeInTheDocument();
  });

  it('confirms before deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => undefined);
    render(
      <PlanEditorDialog
        open
        onOpenChange={() => undefined}
        plan={PRO_PLAN}
        addOns={[]}
        onSubmit={async () => undefined}
        onDelete={onDelete}
      />
    );
    await user.click(screen.getByTestId('plan-editor-start-delete'));
    expect(screen.getByTestId('plan-editor-cancel-delete')).toBeInTheDocument();
    await user.click(screen.getByTestId('plan-editor-confirm-delete'));
    expect(onDelete).toHaveBeenCalledWith('p_pro');
  });
});
