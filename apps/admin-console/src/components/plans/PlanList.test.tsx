// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanList } from './PlanList';
import type { AdminPlan } from '@omyxia/shared-types';

const PRO: AdminPlan = {
  id: 'p_pro',
  name: 'Pro',
  tier: 'PRO',
  priceCents: 9900,
  priceDollars: '99.00',
  description: 'Email + Chat + HR',
  isActive: true,
  sortOrder: 1,
  addOnSlugs: ['addon.crm', 'addon.bi'],
  features: [
    {
      featureKey: 'module.email',
      featureLabel: 'Email',
      category: 'module',
      enabled: true,
      sortOrder: 0,
    },
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

afterEach(() => cleanup());

describe('PlanList', () => {
  it('renders one row per plan with formatted price + tenant count', () => {
    render(<PlanList plans={[FREE, PRO]} onEdit={() => undefined} onCreate={() => undefined} />);
    expect(screen.getByTestId('plan-list-row-p_free-price').textContent).toBe('Free');
    expect(screen.getByTestId('plan-list-row-p_pro-price').textContent).toBe('$99.00/mo');
    expect(screen.getByTestId('plan-list-row-p_pro-tenants').textContent).toBe('47');
  });

  it('renders an empty state with a create CTA when no plans', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<PlanList plans={[]} onEdit={() => undefined} onCreate={onCreate} />);
    expect(screen.getByTestId('plan-list-empty')).toBeInTheDocument();
    await user.click(screen.getByTestId('plan-list-empty-cta'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('renders the loading skeleton when loading and empty', () => {
    render(
      <PlanList
        plans={[]}
        loading
        onEdit={() => undefined}
        onCreate={() => undefined}
      />
    );
    expect(screen.getByTestId('plan-list-loading')).toBeInTheDocument();
  });

  it('emits onEdit when the edit button is clicked', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<PlanList plans={[PRO]} onEdit={onEdit} onCreate={() => undefined} />);
    await user.click(screen.getByTestId('plan-list-row-p_pro-edit'));
    expect(onEdit).toHaveBeenCalledWith(PRO);
  });

  it('renders bundled add-on badges with overflow count', () => {
    const many: AdminPlan = {
      ...PRO,
      addOnSlugs: ['addon.crm', 'addon.bi', 'addon.erp', 'addon.wms', 'addon.mas'],
    };
    render(<PlanList plans={[many]} onEdit={() => undefined} onCreate={() => undefined} />);
    // First three are rendered, the rest are summarised as "+2".
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
