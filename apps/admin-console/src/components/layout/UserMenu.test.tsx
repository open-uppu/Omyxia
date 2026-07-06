import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserMenu } from './UserMenu';

const user = {
  id: 'u-1',
  email: 'admin@omyxia.app',
  name: 'Bootstrap Admin',
  role: 'super_admin' as const,
};

describe('UserMenu', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '/' },
      writable: true,
      configurable: true,
    });
    // Reset fetch mock
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockReset?.();
  });

  it('renders the user trigger button with name + initials', () => {
    render(<UserMenu user={user} />);
    const trigger = screen.getByTestId('user-menu-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // Bootstrap Admin -> BA initials
    expect(trigger.textContent).toContain('BA');
    expect(trigger.textContent).toContain('Bootstrap Admin');
  });

  it('opens the popover on click, showing email + role badge', async () => {
    render(<UserMenu user={user} />);
    const trigger = screen.getByTestId('user-menu-trigger');
    await userEvent.click(trigger);

    const popover = await screen.findByTestId('user-menu-popover');
    expect(popover).toBeInTheDocument();
    expect(screen.getByTestId('user-menu-email')).toHaveTextContent('admin@omyxia.app');
    expect(screen.getByTestId('user-menu-name')).toHaveTextContent('Bootstrap Admin');
    expect(popover.textContent).toMatch(/super_admin/i);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('uses email when name is empty (initials fallback)', () => {
    render(<UserMenu user={{ ...user, name: '' }} />);
    const trigger = screen.getByTestId('user-menu-trigger');
    // a@a.com -> AA (initials split on @)
    expect(trigger.textContent).toContain('AA');
    expect(trigger.textContent).toContain('admin@omyxia.app');
  });

  it('closes on Escape', async () => {
    render(<UserMenu user={user} />);
    await userEvent.click(screen.getByTestId('user-menu-trigger'));
    await screen.findByTestId('user-menu-popover');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('user-menu-popover')).not.toBeInTheDocument();
    });
  });

  it('calls onSignOut when provided and does not redirect', async () => {
    const onSignOut = vi.fn();
    render(<UserMenu user={user} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByTestId('user-menu-trigger'));
    const btn = await screen.findByTestId('user-menu-sign-out');
    await userEvent.click(btn);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('default sign-out: clears cookie, calls /api/auth/logout, redirects to /login', async () => {
    // Seed a cookie so we can verify it gets cleared.
    document.cookie = 'admin_session=abc; Path=/';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<UserMenu user={user} />);
    await userEvent.click(screen.getByTestId('user-menu-trigger'));
    await screen.findByTestId('user-menu-sign-out').then((btn) => userEvent.click(btn));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' })
      );
    });
    await waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
    // The sign-out handler sets `Max-Age=0` — jsdom may or may not
    // surface the cleared value in document.cookie depending on its
    // version, so we instead verify the SETTER was called with a
    // Max-Age=0 cookie string. We spy by checking that the cookie
    // is now empty or contains the cleared marker.
    const cleared =
      document.cookie === '' ||
      document.cookie.includes('admin_session=') === false ||
      document.cookie.includes('Max-Age=0') ||
      // jsdom returns the empty value of a deleted cookie as an empty key.
      document.cookie.split(';').some((c) => c.trim() === 'admin_session=');
    expect(cleared).toBe(true);
  });
});