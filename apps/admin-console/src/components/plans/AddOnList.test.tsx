// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddOnList } from './AddOnList';
import type { AdminAddOn } from '@omyxia/shared-types';

const CRM: AdminAddOn = {
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

describe('AddOnList', () => {
  it('renders a row per add-on with plan count', () => {
    render(<AddOnList addOns={[CRM]} onEdit={() => undefined} onCreate={() => undefined} />);
    expect(screen.getByTestId('addon-list-row-ao_crm-price').textContent).toBe('$50.00/mo');
    expect(screen.getByTestId('addon-list-row-ao_crm-plans').textContent).toBe('2');
  });

  it('renders an empty state CTA when no add-ons', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<AddOnList addOns={[]} onEdit={() => undefined} onCreate={onCreate} />);
    expect(screen.getByTestId('addon-list-empty')).toBeInTheDocument();
    await user.click(screen.getByTestId('addon-list-empty-cta'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('emits onEdit when the row edit button is clicked', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<AddOnList addOns={[CRM]} onEdit={onEdit} onCreate={() => undefined} />);
    await user.click(screen.getByTestId('addon-list-row-ao_crm-edit'));
    expect(onEdit).toHaveBeenCalledWith(CRM);
  });
});
