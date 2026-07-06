import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Topbar } from './Topbar';

const user = {
  id: 'u-1',
  email: 'admin@omyxia.app',
  name: 'Bootstrap Admin',
  role: 'super_admin' as const,
};

describe('Topbar', () => {
  it('renders the mobile nav trigger on small viewports (always visible in DOM, hidden via CSS)', () => {
    render(<Topbar user={user} />);
    const btn = screen.getByTestId('topbar-mobile-nav');
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('aria-label')).toBe('Open navigation');
  });

  it('calls onOpenMobileNav when the trigger is clicked', async () => {
    const handler = vi.fn();
    render(<Topbar user={user} onOpenMobileNav={handler} />);
    await userEvent.click(screen.getByTestId('topbar-mobile-nav'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('renders the user menu inside the topbar', () => {
    render(<Topbar user={user} />);
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
    expect(screen.getByTestId('user-menu-trigger')).toBeInTheDocument();
  });

  it('renders the title slot for page-level titles', () => {
    render(<Topbar user={user} />);
    expect(screen.getByTestId('topbar-title-slot')).toBeInTheDocument();
  });
});