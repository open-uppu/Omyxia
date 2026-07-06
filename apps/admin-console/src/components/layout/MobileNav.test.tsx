import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileNav } from './MobileNav';

// next/navigation is mocked at the test runner level via vi.mock in setup.
// We can't easily mock `usePathname` from inside a single test file without
// vi.mock hoisting, so this file is a focused render-only smoke test.

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

describe('MobileNav', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MobileNav open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the drawer when open with all five links', () => {
    render(<MobileNav open={true} onClose={() => {}} />);
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
    for (const key of ['dashboard', 'tenants', 'plans', 'audit', 'settings']) {
      expect(screen.getByTestId(`mobile-nav-link-${key}`)).toBeInTheDocument();
    }
  });

  it('highlights the active item based on usePathname', () => {
    render(<MobileNav open={true} onClose={() => {}} />);
    const dashboard = screen.getByTestId('mobile-nav-link-dashboard');
    expect(dashboard.getAttribute('aria-current')).toBe('page');
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(<MobileNav open={true} onClose={onClose} />);
    await userEvent.click(screen.getByTestId('mobile-nav-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(<MobileNav open={true} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onClose when a link is clicked', async () => {
    const onClose = vi.fn();
    render(<MobileNav open={true} onClose={onClose} />);
    await userEvent.click(screen.getByTestId('mobile-nav-link-tenants'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});