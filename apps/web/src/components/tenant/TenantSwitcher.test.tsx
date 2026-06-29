import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantSwitcher } from './TenantSwitcher';
import type { TenantSummary } from '@/lib/api';

// We mock the API client so the test does not depend on a live backend.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      tenants: {
        ...actual.api.tenants,
        switch: vi.fn(),
      },
    },
  };
});

import { api } from '@/lib/api';

const tenants: TenantSummary[] = [
  { id: 't1', slug: 'acme', name: 'Acme Corp', role: 'OWNER' },
  { id: 't2', slug: 'globex', name: 'Globex Inc', role: 'ADMIN' },
  { id: 't3', slug: 'initech', name: 'Initech LLC', role: 'MEMBER' },
];

describe('TenantSwitcher', () => {
  beforeEach(() => {
    vi.mocked(api.tenants.switch).mockReset();
    // default location mock — jsdom supports location.reload
    if (typeof window !== 'undefined' && !window.location.reload) {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: vi.fn() },
        writable: true,
      });
    }
  });

  it('shows the current tenant name on the trigger and opens the list on click', async () => {
    const user = userEvent.setup();
    render(<TenantSwitcher current={tenants[0]} tenants={tenants} />);

    expect(screen.getByTestId('tenant-switcher-current-name')).toHaveTextContent(
      'Acme Corp'
    );

    // List is not visible initially
    expect(screen.queryByTestId('tenant-switcher-list')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('tenant-switcher-trigger'));

    const list = screen.getByTestId('tenant-switcher-list');
    expect(list).toBeInTheDocument();
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(tenants.length);
    expect(within(list).getByTestId(`tenant-option-${tenants[0].id}`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // "Create new tenant" link is present
    expect(within(list).getByTestId('tenant-switcher-create')).toHaveAttribute(
      'href',
      '/onboarding'
    );
  });

  it('calls POST /api/tenants/:id/switch when a tenant is selected and reloads on success', async () => {
    vi.mocked(api.tenants.switch).mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      tenant: tenants[1],
      accessToken: 'tok',
      expiresAt: new Date().toISOString(),
    });

    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
      configurable: true,
    });

    render(<TenantSwitcher current={tenants[0]} tenants={tenants} />);

    await userEvent.click(screen.getByTestId('tenant-switcher-trigger'));
    await userEvent.click(screen.getByTestId(`tenant-option-${tenants[1].id}`));

    await waitFor(() => {
      expect(api.tenants.switch).toHaveBeenCalledWith('t2');
    });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
  });

  it('does not call the switch API when selecting the already-active tenant', async () => {
    render(<TenantSwitcher current={tenants[0]} tenants={tenants} />);

    await userEvent.click(screen.getByTestId('tenant-switcher-trigger'));
    await userEvent.click(screen.getByTestId(`tenant-option-${tenants[0].id}`));

    expect(api.tenants.switch).not.toHaveBeenCalled();
    // List closes
    expect(screen.queryByTestId('tenant-switcher-list')).not.toBeInTheDocument();
  });

  it('shows the onboarding CTA when there are no tenants', () => {
    render(<TenantSwitcher current={tenants[0]} tenants={[]} onboardingHref="/signup" />);
    const empty = screen.getByTestId('tenant-switcher-empty');
    expect(empty).toBeInTheDocument();
    expect(within(empty).getByText('Onboarding')).toHaveAttribute('href', '/signup');
  });

  it('surfaces the error from the API', async () => {
    vi.mocked(api.tenants.switch).mockRejectedValue(new Error('network down'));
    render(<TenantSwitcher current={tenants[0]} tenants={tenants} />);

    await userEvent.click(screen.getByTestId('tenant-switcher-trigger'));
    await userEvent.click(screen.getByTestId(`tenant-option-${tenants[1].id}`));

    const alert = await screen.findByTestId('tenant-switcher-error');
    expect(alert).toHaveTextContent('network down');
    // option is re-enabled after failure
    expect(api.tenants.switch).toHaveBeenCalled();
  });

  it('closes when Escape is pressed', async () => {
    render(<TenantSwitcher current={tenants[0]} tenants={tenants} />);
    await userEvent.click(screen.getByTestId('tenant-switcher-trigger'));
    expect(screen.getByTestId('tenant-switcher-list')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('tenant-switcher-list')).not.toBeInTheDocument();
  });
});
