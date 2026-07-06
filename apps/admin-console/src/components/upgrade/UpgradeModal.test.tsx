// @vitest-environment jsdom
//
// Component + provider tests for the upgrade modal (P3.4). Covers:
//   - Renders nothing by default (closed).
//   - `open()` shows the modal with feature label, plan badges,
//     price delta, mailto CTA.
//   - Dismissing (Esc / X button / backdrop) clears state and pushes
//     a `dismissed` impression.
//   - CTA clicks push `cta_clicked` with `ctaTarget: 'mailto'` or
//     `'in_app_upgrade'`.
//   - `handleResponse` opens the modal when fed a 403 with the
//     expected FEATURE_NOT_INCLUDED payload.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  UpgradeModalProvider,
  useUpgradeModal,
} from './UpgradeModalProvider';
import { UpgradeModal } from './UpgradeModal';
import { upgradeImpressionBus } from '@/lib/upgrade-modal-impressions';

function TestHarness({
  defaultAdminEmail = 'admin@omyxia.app',
}: {
  defaultAdminEmail?: string;
}) {
  const { open, isOpen, current } = useUpgradeModal();
  return (
    <div>
      <div data-testid="harness-state">
        {isOpen ? 'open' : 'closed'}
        {current ? `:${current.feature}` : ''}
      </div>
      <button
        type="button"
        data-testid="harness-open"
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
        Open modal
      </button>
    </div>
  );
}

function renderWithProvider(ui: React.ReactNode, props: { defaultAdminEmail?: string; disableBeacon?: boolean } = {}) {
  return render(
    <UpgradeModalProvider
      defaultAdminEmail={props.defaultAdminEmail}
      disableBeacon={props.disableBeacon ?? true}
    >
      {ui}
      <UpgradeModal />
    </UpgradeModalProvider>
  );
}

describe('UpgradeModal (provider + component)', () => {
  beforeEach(() => {
    upgradeImpressionBus.reset();
  });
  afterEach(() => {
    upgradeImpressionBus.reset();
    vi.restoreAllMocks();
  });

  it('renders nothing when the modal is closed', () => {
    renderWithProvider(<div data-testid="page">page</div>);
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('opens the modal and shows the feature label + price delta', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestHarness />);

    expect(screen.getByTestId('harness-state')).toHaveTextContent('closed');
    await user.click(screen.getByTestId('harness-open'));

    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('upgrade-modal-title')).toHaveTextContent('Upgrade required');
    expect(screen.getByTestId('upgrade-modal-message')).toHaveTextContent('CRM');
    expect(screen.getByTestId('upgrade-modal-current-plan')).toHaveTextContent('Free');
    expect(screen.getByTestId('upgrade-modal-recommended-plan-chip')).toHaveTextContent('Pro');
    expect(screen.getByTestId('upgrade-modal-price')).toHaveTextContent('$99/mo');
  });

  it('uses "Contact admin" when the price is null (contact-us features)', async () => {
    const user = userEvent.setup();
    function CustomHarness() {
      const { open } = useUpgradeModal();
      return (
        <button
          type="button"
          data-testid="harness-open-contact"
          onClick={() =>
            open({
              feature: 'module.crm',
              featureLabel: 'CRM',
              currentPlan: 'FREE',
              recommendedPlan: 'PRO',
              priceDeltaCents: null,
            })
          }
        >
          Open
        </button>
      );
    }
    renderWithProvider(<CustomHarness />);
    await user.click(screen.getByTestId('harness-open-contact'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal-price')).toHaveTextContent('Contact admin');
    });
  });

  it('renders add-on rows when requiredAddOns is provided', async () => {
    const user = userEvent.setup();
    function CustomHarness() {
      const { open } = useUpgradeModal();
      return (
        <button
          type="button"
          data-testid="harness-open-addons"
          onClick={() =>
            open({
              feature: 'module.crm',
              featureLabel: 'CRM',
              currentPlan: 'FREE',
              recommendedPlan: 'PRO',
              requiredAddOns: ['addon.crm'],
            })
          }
        >
          Open
        </button>
      );
    }
    renderWithProvider(<CustomHarness />);
    await user.click(screen.getByTestId('harness-open-addons'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal-addons')).toBeInTheDocument();
    });
    expect(screen.getByTestId('upgrade-modal-addon-addon.crm')).toHaveTextContent('CRM');
  });

  it('dismisses on X button click and pushes a `dismissed` impression', async () => {
    const user = userEvent.setup();
    const flushSpy = vi.spyOn(upgradeImpressionBus, 'flush').mockResolvedValue({
      attempted: 0, delivered: 0, dropped: 0,
    });
    renderWithProvider(<TestHarness />);
    await user.click(screen.getByTestId('harness-open'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    });

    // queueMicrotask runs the `shown` event in the next tick — give
    // it a frame to drain before we dismiss so the buffer isn't empty.
    await new Promise((r) => setTimeout(r, 0));

    await user.click(screen.getByTestId('upgrade-modal-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
    });
    const events = upgradeImpressionBus.peek();
    expect(events.some((e) => e.kind === 'dismissed')).toBe(true);
    expect(flushSpy).toHaveBeenCalled();
  });

  it('dismisses on Escape key', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestHarness />);
    await user.click(screen.getByTestId('harness-open'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
    });
  });

  it('CTA click pushes a `cta_clicked` impression with `ctaTarget: mailto`', async () => {
    const user = userEvent.setup();
    vi.spyOn(upgradeImpressionBus, 'flush').mockResolvedValue({
      attempted: 0, delivered: 0, dropped: 0,
    });
    renderWithProvider(<TestHarness />);
    await user.click(screen.getByTestId('harness-open'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal-cta')).toBeInTheDocument();
    });
    const cta = screen.getByTestId('upgrade-modal-cta');
    expect(cta.getAttribute('href')).toContain('mailto:admin@omyxia.app');
    expect(cta.getAttribute('href')).toContain('subject=Upgrade');
    await user.click(cta);
    const events = upgradeImpressionBus.peek();
    expect(events.some((e) => e.kind === 'cta_clicked' && e.ctaTarget === 'mailto')).toBe(true);
  });

  it('secondary CTA pushes `plan_viewed` with `ctaTarget: in_app_upgrade`', async () => {
    const user = userEvent.setup();
    vi.spyOn(upgradeImpressionBus, 'flush').mockResolvedValue({
      attempted: 0, delivered: 0, dropped: 0,
    });
    renderWithProvider(<TestHarness />);
    await user.click(screen.getByTestId('harness-open'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal-secondary')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('upgrade-modal-secondary'));
    const events = upgradeImpressionBus.peek();
    expect(events.some((e) => e.kind === 'plan_viewed' && e.ctaTarget === 'in_app_upgrade')).toBe(true);
  });

  it('uses the override defaultAdminEmail for the mailto CTA', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestHarness />, { defaultAdminEmail: 'billing@omyxia.app' });
    await user.click(screen.getByTestId('harness-open'));
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal-cta')).toBeInTheDocument();
    });
    expect(screen.getByTestId('upgrade-modal-cta').getAttribute('href'))
      .toContain('mailto:billing@omyxia.app');
  });
});

describe('UpgradeModalProvider.handleResponse', () => {
  beforeEach(() => {
    upgradeImpressionBus.reset();
  });

  it('opens the modal when given a 403 with FEATURE_NOT_INCLUDED', async () => {
    function Harness() {
      const { isOpen, handleResponse } = useUpgradeModal();
      return (
        <div>
          <div data-testid="state">{isOpen ? 'open' : 'closed'}</div>
          <button
            type="button"
            data-testid="trigger"
            onClick={async () => {
              const res = new Response(
                JSON.stringify({
                  statusCode: 403,
                  error: 'FEATURE_NOT_INCLUDED',
                  feature: 'module.crm',
                  featureLabel: 'CRM',
                  currentPlan: 'FREE',
                  recommendedPlan: 'PRO',
                  requiredAddOns: [],
                  priceDeltaCents: 9900,
                  currency: 'USD',
                  upgradeAdminEmail: 'admin@omyxia.app',
                  upgradeUrl: '/upgrade',
                }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
              );
              await handleResponse(res);
            }}
          >
            Trigger
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    vi.spyOn(upgradeImpressionBus, 'flush').mockResolvedValue({
      attempted: 0, delivered: 0, dropped: 0,
    });
    renderWithProvider(<Harness />);
    expect(screen.getByTestId('state')).toHaveTextContent('closed');
    await user.click(screen.getByTestId('trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('open');
    });
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    });
  });

  it('does not open the modal for non-403 responses', async () => {
    function Harness() {
      const { isOpen, handleResponse } = useUpgradeModal();
      return (
        <div>
          <div data-testid="state">{isOpen ? 'open' : 'closed'}</div>
          <button
            type="button"
            data-testid="trigger"
            onClick={async () => {
              await handleResponse(
                new Response(JSON.stringify({ ok: true }), { status: 200 })
              );
            }}
          >
            Trigger
          </button>
        </div>
      );
    }
    const user = userEvent.setup();
    renderWithProvider(<Harness />);
    await user.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('state')).toHaveTextContent('closed');
  });

  it('does not open the modal for a 403 with a different error code', async () => {
    function Harness() {
      const { isOpen, handleResponse } = useUpgradeModal();
      return (
        <div>
          <div data-testid="state">{isOpen ? 'open' : 'closed'}</div>
          <button
            type="button"
            data-testid="trigger"
            onClick={async () => {
              await handleResponse(
                new Response(
                  JSON.stringify({
                    statusCode: 403,
                    error: 'forbidden',
                    message: 'RBAC denied',
                  }),
                  { status: 403, headers: { 'Content-Type': 'application/json' } }
                )
              );
            }}
          >
            Trigger
          </button>
        </div>
      );
    }
    const user = userEvent.setup();
    renderWithProvider(<Harness />);
    await user.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('state')).toHaveTextContent('closed');
  });
});

describe('useUpgradeModal', () => {
  it('throws when used outside the provider', () => {
    // Suppress the React error boundary noise so the test output is clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<TestHarness />)).toThrow(/UpgradeModalProvider/);
    errSpy.mockRestore();
  });
});