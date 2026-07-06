// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlansClient } from './PlansClient';
import type { AdminPlan, AdminAddOn, ListPlansResponse } from '@omyxia/shared-types';

afterEach(() => cleanup());

const PRO: AdminPlan = {
  id: 'p_pro',
  name: 'Pro',
  tier: 'PRO',
  priceCents: 9900,
  priceDollars: '99.00',
  description: 'Email + Chat + HR',
  isActive: true,
  sortOrder: 1,
  addOnSlugs: ['addon.crm'],
  features: [
    { featureKey: 'module.email', featureLabel: 'Email', category: 'module', enabled: true, sortOrder: 0 },
  ],
  entitlementCount: 47,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

const FREE: AdminPlan = {
  id: 'p_free',
  name: 'Free',
  tier: 'FREE',
  priceCents: 0,
  priceDollars: '0.00',
  description: 'Starter',
  isActive: true,
  sortOrder: 0,
  addOnSlugs: [],
  features: [],
  entitlementCount: 124,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

const CRM: AdminAddOn = {
  id: 'ao_crm',
  name: 'CRM',
  slug: 'addon.crm',
  priceCents: 5000,
  priceDollars: '50.00',
  description: 'CRM module',
  appliesTo: 'ALL',
  isActive: true,
  planCount: 1,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

const PLANS_PAYLOAD: ListPlansResponse = {
  plans: [FREE, PRO],
  addOns: [CRM],
  generatedAt: '2026-07-06T00:00:00.000Z',
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(PLANS_PAYLOAD), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  ) as unknown as typeof fetch;
});

describe('PlansClient', () => {
  it('renders both tabs and counts', async () => {
    render(<PlansClient initialTab="plans" />);
    await waitFor(() => {
      expect(screen.getByTestId('plans-tab-plans')).toHaveTextContent(/Plans.*2/);
    });
    expect(screen.getByTestId('plans-tab-addons')).toHaveTextContent(/Add-ons.*1/);
  });

  it('switches tabs and shows add-on list', async () => {
    const user = userEvent.setup();
    render(<PlansClient initialTab="plans" />);
    await waitFor(() => expect(screen.getByTestId('plan-list-row-p_pro')).toBeInTheDocument());
    await user.click(screen.getByTestId('plans-tab-addons'));
    expect(screen.getByTestId('addon-list-row-ao_crm')).toBeInTheDocument();
  });

  it('opens the create-plan dialog when the new plan button is clicked', async () => {
    const user = userEvent.setup();
    render(<PlansClient initialTab="plans" />);
    await waitFor(() => expect(screen.getByTestId('plan-list-row-p_pro')).toBeInTheDocument());
    await user.click(screen.getByTestId('plans-new'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the edit-plan dialog when a row edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<PlansClient initialTab="plans" />);
    await waitFor(() => expect(screen.getByTestId('plan-list-row-p_pro')).toBeInTheDocument());
    await user.click(screen.getByTestId('plan-list-row-p_pro-edit'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Pre-filled with the plan name.
    expect(screen.getByTestId('plan-editor-name')).toHaveValue('Pro');
  });
});
