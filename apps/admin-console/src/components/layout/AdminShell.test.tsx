// @vitest-environment jsdom
//
// Integration test for AdminShell — verifies the upgrade-modal
// provider wraps the layout tree so any descendant can pop the modal
// via `useUpgradeModal()`.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminShell } from './AdminShell';
import { useUpgradeModal } from '@/components/upgrade/UpgradeModalProvider';
import { upgradeImpressionBus } from '@/lib/upgrade-modal-impressions';

const user = {
  id: 'u-1',
  email: 'admin@omyxia.app',
  name: 'Bootstrap Admin',
  role: 'super_admin' as const,
};

function ProbeButton() {
  const { open, isOpen } = useUpgradeModal();
  return (
    <button
      type="button"
      data-testid="probe-open"
      onClick={() =>
        open({
          feature: 'module.crm',
          featureLabel: 'CRM',
          currentPlan: 'FREE',
          recommendedPlan: 'PRO',
          priceDeltaCents: 9900,
        })
      }
    >
      {isOpen ? 'modal-open' : 'modal-closed'}
    </button>
  );
}

describe('AdminShell', () => {
  it('renders the chrome (sidebar + topbar)', () => {
    render(
      <AdminShell user={user}>
        <div data-testid="page-content">hello</div>
      </AdminShell>
    );
    expect(screen.getByTestId('admin-shell')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('exposes the upgrade modal context to children', async () => {
    vi.spyOn(upgradeImpressionBus, 'flush').mockResolvedValue({
      attempted: 0, delivered: 0, dropped: 0,
    });
    const userEv = userEvent.setup();
    render(
      <AdminShell user={user}>
        <ProbeButton />
      </AdminShell>
    );
    expect(screen.getByTestId('probe-open')).toHaveTextContent('modal-closed');
    await userEv.click(screen.getByTestId('probe-open'));
    expect(await screen.findByTestId('upgrade-modal')).toBeInTheDocument();
  });
});