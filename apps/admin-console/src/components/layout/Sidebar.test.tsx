import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders all five nav items', () => {
    render(<Sidebar activeHref="/dashboard" />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    for (const key of ['dashboard', 'tenants', 'plans', 'audit', 'settings']) {
      expect(screen.getByTestId(`sidebar-link-${key}`)).toBeInTheDocument();
    }
  });

  it('marks the active link with aria-current + data-active', () => {
    render(<Sidebar activeHref="/tenants" />);
    const tenants = screen.getByTestId('sidebar-link-tenants');
    expect(tenants.getAttribute('aria-current')).toBe('page');
    expect(tenants.getAttribute('data-active')).toBe('true');

    const dashboard = screen.getByTestId('sidebar-link-dashboard');
    expect(dashboard.getAttribute('aria-current')).toBeNull();
    expect(dashboard.getAttribute('data-active')).toBeNull();
  });

  it('highlights a parent for nested routes', () => {
    render(<Sidebar activeHref="/tenants/abc-123/edit" />);
    const tenants = screen.getByTestId('sidebar-link-tenants');
    expect(tenants.getAttribute('aria-current')).toBe('page');
  });

  it('renders the brand header', () => {
    render(<Sidebar activeHref="/dashboard" />);
    expect(screen.getByText(/Omyxia Admin/i)).toBeInTheDocument();
  });
});