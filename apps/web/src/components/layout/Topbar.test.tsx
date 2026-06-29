import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Topbar } from './Topbar';
import type { TenantSummary } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, logout: vi.fn() },
    },
  };
});
import { api } from '@/lib/api';

const user = { id: 'u1', email: 'alice@example.com', name: 'Alice Liddell' };
const tenants: TenantSummary[] = [
  { id: 't1', slug: 'acme', name: 'Acme Corp', role: 'OWNER' },
  { id: 't2', slug: 'globex', name: 'Globex', role: 'MEMBER' },
];

describe('Topbar', () => {
  beforeEach(() => {
    vi.mocked(api.auth.logout).mockReset();
    // Default: clear window.location mock state per test
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '/' },
      writable: true,
      configurable: true,
    });
  });

  it('renders logo, tenant switcher, and user menu trigger', async () => {
    render(<Topbar user={user} currentTenant={tenants[0]} tenants={tenants} />);

    expect(screen.getByTestId('topbar-logo')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-logo')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByTestId('topbar-user-trigger')).toBeInTheDocument();

    // Tenant switcher is present (uses its own data-testid)
    expect(screen.getByTestId('tenant-switcher-trigger')).toBeInTheDocument();
  });

  it('opens the user menu and shows the user details and account/settings links', async () => {
    const userEv = userEvent.setup();
    render(<Topbar user={user} currentTenant={tenants[0]} tenants={tenants} />);
    await userEv.click(screen.getByTestId('topbar-user-trigger'));

    const menu = screen.getByTestId('topbar-user-menu');
    expect(within(menu).getByTestId('topbar-user-name')).toHaveTextContent('Alice');
    expect(within(menu).getByTestId('topbar-menu-account')).toHaveAttribute('href', '/account');
    expect(within(menu).getByTestId('topbar-menu-settings')).toHaveAttribute('href', '/settings');
  });

  it('signs out via POST /api/auth/logout and redirects to /login', async () => {
    vi.mocked(api.auth.logout).mockResolvedValue({ success: true });
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, set href(v: string) { hrefSpy(v); } },
      writable: true,
      configurable: true,
    });

    render(<Topbar user={user} currentTenant={tenants[0]} tenants={tenants} />);
    await userEvent.click(screen.getByTestId('topbar-user-trigger'));
    await userEvent.click(screen.getByTestId('topbar-sign-out'));

    await waitFor(() => {
      expect(api.auth.logout).toHaveBeenCalled();
      expect(hrefSpy).toHaveBeenCalledWith('/login');
    });
  });

  it('falls back to /login redirect when logout API throws', async () => {
    vi.mocked(api.auth.logout).mockRejectedValue(new Error('boom'));
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, set href(v: string) { hrefSpy(v); } },
      writable: true,
      configurable: true,
    });

    render(<Topbar user={user} currentTenant={tenants[0]} tenants={tenants} />);
    await userEvent.click(screen.getByTestId('topbar-user-trigger'));
    await userEvent.click(screen.getByTestId('topbar-sign-out'));

    await waitFor(() => {
      expect(hrefSpy).toHaveBeenCalledWith('/login');
    });
  });

  it('closes the user menu when Escape is pressed', async () => {
    render(<Topbar user={user} currentTenant={tenants[0]} tenants={tenants} />);
    await userEvent.click(screen.getByTestId('topbar-user-trigger'));
    expect(screen.getByTestId('topbar-user-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('topbar-user-menu')).not.toBeInTheDocument();
  });
});
